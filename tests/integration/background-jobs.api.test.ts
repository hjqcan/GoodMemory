import { describe, expect, it } from "bun:test";
import {
  createGoodMemory,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  type GoodMemoryTraceSpan,
} from "../../src";

describe("public background memory jobs API", () => {
  it("rejects invalid temporal context before a job is queued", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const input = {
      idempotencyKey: "invalid-temporal-job",
      messages: [{
        content: "Remember this.",
        observedAt: "not-a-time",
        role: "user",
      }],
      scope: { userId: "invalid-temporal-job-user" },
    };

    await expect(memory.jobs.enqueueRemember(input)).rejects.toThrow(
      "Invalid messages[0].observedAt",
    );
    expect(await memory.jobs.drain()).toMatchObject({
      jobs: [],
      processed: 0,
    });
  });

  it("keeps the call timezone in queued payload identity and execution", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const base = {
      idempotencyKey: "temporal-job",
      locale: "zh-CN",
      messages: [{
        content: "我昨天吃了番茄炒蛋。",
        observedAt: "2026-08-12T02:00:00.000Z",
        role: "user",
      }],
      scope: { userId: "job-temporal-user" },
    };
    await memory.jobs.enqueueRemember({ ...base, timezone: "Asia/Shanghai" });

    await expect(memory.jobs.enqueueRemember({
      ...base,
      timezone: "America/New_York",
    })).rejects.toThrow(/idempotency/i);
    await memory.jobs.drain();
    const exported = await memory.exportMemory({ scope: base.scope });
    expect(exported.durable.facts[0]?.occurrence?.timezone).toBe("Asia/Shanghai");
  });

  it("queues remember writes and commits them only when drained", async () => {
    const documentStore = createInMemoryDocumentStore();
    const spans: GoodMemoryTraceSpan[] = [];
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      observability: {
        traceSink: {
          emit(span) {
            spans.push(span);
          },
        },
      },
    });
    const scope = {
      userId: "jobs-user",
      workspaceId: "jobs-workspace",
      sessionId: "jobs-session",
    };
    const input = {
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that the runtime jobs smoke is blocked on staging.",
        },
      ],
      idempotencyKey: "jobs-turn-1",
      reason: "post_response_memory_write",
    };

    const queued = await memory.jobs.enqueueRemember(input);
    const duplicate = await memory.jobs.enqueueRemember(input);

    expect(queued.status).toBe("queued");
    expect(queued.operation).toBe("remember");
    expect(queued.attempts).toBe(0);
    expect(queued.idempotencyKey).toBe("jobs-turn-1");
    expect(duplicate.jobId).toBe(queued.jobId);
    expect(await documentStore.query("facts", { userId: "jobs-user" })).toHaveLength(0);

    const drained = await memory.jobs.drain();
    const committed = await memory.jobs.getJob({ jobId: queued.jobId });

    expect(drained.processed).toBe(1);
    expect(drained.jobs).toHaveLength(1);
    expect(drained.jobs[0]?.status).toBe("succeeded");
    expect(committed?.status).toBe("succeeded");
    expect(committed?.attempts).toBe(1);
    expect(committed?.linkedMemoryIds?.length).toBeGreaterThan(0);
    expect(committed?.linkedEvidenceIds?.length).toBeGreaterThan(0);
    expect(committed?.linkedTraceIds.length).toBeGreaterThanOrEqual(2);
    expect(await documentStore.query("facts", { userId: "jobs-user" })).toHaveLength(1);

    const spanNames = spans.map((span) => `${span.name}:${span.status}`);
    expect(spanNames).toContain("writeback.job.enqueue:started");
    expect(spanNames).toContain("writeback.job.enqueue:succeeded");
    expect(spanNames).toContain("writeback.job.commit:started");
    expect(spanNames).toContain("writeback.job.commit:succeeded");
    expect(JSON.stringify(spans)).not.toContain("runtime jobs smoke");
    expect(JSON.stringify(spans)).not.toContain("jobs-user");
    expect(spans.every((span) => span.redaction.containsRawUserText === false)).toBe(
      true,
    );
  });

  it("keeps failed remember jobs retryable without committing partial state", async () => {
    const documentStore = createInMemoryDocumentStore();
    let extractionAttempts = 0;
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: {
        extractor: {
          async extract(input) {
            extractionAttempts += 1;
            if (extractionAttempts === 1) {
              throw new Error("transient extractor unavailable");
            }

            return {
              ignoredMessageCount: 0,
              candidates: [
                {
                  id: "retry-candidate",
                  kindHint: "fact",
                  explicitness: "explicit",
                  content: input.messages[0]?.content ?? "",
                  sourceMessageIndex: 0,
                  sourceRole: "user",
                  metadata: {
                    category: "project",
                    factKind: "generic_project",
                    scopeKind: "project",
                  },
                },
              ],
            };
          },
        },
      },
    });
    const queued = await memory.jobs.enqueueRemember({
      scope: { userId: "retry-user", sessionId: "retry-session" },
      messages: [
        {
          role: "user",
          content: "Remember that retry jobs should eventually commit.",
        },
      ],
      idempotencyKey: "retry-turn-1",
    });

    const firstDrain = await memory.jobs.drain();
    const failed = await memory.jobs.getJob({ jobId: queued.jobId });

    expect(firstDrain.jobs[0]?.status).toBe("failed");
    expect(failed?.status).toBe("failed");
    expect(failed?.attempts).toBe(1);
    expect(failed?.lastError?.code).toBe("remember_failed");
    expect(await documentStore.query("facts", { userId: "retry-user" })).toHaveLength(0);

    const retried = await memory.jobs.retryJob({ jobId: queued.jobId });
    const secondDrain = await memory.jobs.drain();
    const succeeded = await memory.jobs.getJob({ jobId: queued.jobId });

    expect(retried?.status).toBe("queued");
    expect(secondDrain.jobs[0]?.status).toBe("succeeded");
    expect(succeeded?.status).toBe("succeeded");
    expect(succeeded?.attempts).toBe(2);
    expect(succeeded?.lastError).toBeUndefined();
    expect(await documentStore.query("facts", { userId: "retry-user" })).toHaveLength(1);
  });

  it("keeps assisted-extraction fallback jobs retryable after a partial rules write", async () => {
    const documentStore = createInMemoryDocumentStore();
    let assistedAttempts = 0;
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        assistedExtractor: {
          async extract() {
            assistedAttempts += 1;
            if (assistedAttempts === 1) {
              throw new Error("assisted extractor unavailable");
            }
            return { candidates: [], ignoredMessageCount: 0 };
          },
        },
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });
    const queued = await memory.jobs.enqueueRemember({
      extractionStrategy: "llm-assisted",
      idempotencyKey: "assisted-retry-turn-1",
      messages: [{
        content: "Remember that the durable extraction cursor must retry failures.",
        role: "user",
      }],
      scope: { userId: "assisted-retry-user", sessionId: "retry-session" },
    });

    const firstDrain = await memory.jobs.drain();
    expect(firstDrain.jobs[0]).toMatchObject({
      attempts: 1,
      lastError: { code: "remember_failed" },
      status: "failed",
    });
    expect(
      await documentStore.query("facts", { userId: "assisted-retry-user" }),
    ).toHaveLength(1);

    expect((await memory.jobs.retryJob({ jobId: queued.jobId }))?.status).toBe(
      "queued",
    );
    const secondDrain = await memory.jobs.drain();
    expect(secondDrain.jobs[0]).toMatchObject({ attempts: 2, status: "succeeded" });
    expect(assistedAttempts).toBe(2);
  });

  it("marks fully rejected remember jobs as blocked instead of failed", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      policy: {
        shouldRemember() {
          return false;
        },
      },
    });
    const queued = await memory.jobs.enqueueRemember({
      scope: { userId: "blocked-user", sessionId: "blocked-session" },
      messages: [
        {
          role: "user",
          content: "Remember that this policy-blocked payload must not write.",
        },
      ],
      idempotencyKey: "blocked-turn-1",
    });

    const drained = await memory.jobs.drain();
    const blocked = await memory.jobs.getJob({ jobId: queued.jobId });

    expect(drained.jobs[0]?.status).toBe("blocked");
    expect(blocked?.status).toBe("blocked");
    expect(blocked?.attempts).toBe(1);
    expect(blocked?.lastError?.code).toBe("write_blocked");
    expect(blocked?.linkedMemoryIds).toEqual([]);
  });

  it("does not expose raw profile ids through job receipts or trace links", async () => {
    const spans: GoodMemoryTraceSpan[] = [];
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      observability: {
        scopeDigestSecret: "trusted-job-profile-secret",
        traceSink: {
          emit(span) {
            spans.push(span);
          },
        },
      },
    });
    const queued = await memory.jobs.enqueueRemember({
      scope: { userId: "raw-profile-job-user", sessionId: "profile-session" },
      messages: [
        {
          role: "user",
          content: "Remember that my name is Ada Lovelace.",
        },
      ],
      idempotencyKey: "profile-turn-1",
    });

    await memory.jobs.drain();
    const committed = await memory.jobs.getJob({ jobId: queued.jobId });

    expect(committed?.status).toBe("succeeded");
    expect(committed?.linkedMemoryIds).not.toContain("raw-profile-job-user");
    expect(JSON.stringify(committed)).not.toContain("raw-profile-job-user");
    expect(JSON.stringify(spans)).not.toContain("raw-profile-job-user");
  });

  it("treats ordinary no-op remember jobs as succeeded without write_blocked", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });
    const queued = await memory.jobs.enqueueRemember({
      scope: { userId: "noop-user", sessionId: "noop-session" },
      messages: [
        {
          role: "user",
          content: "Hello, thanks for the quick update.",
        },
      ],
      idempotencyKey: "noop-turn-1",
    });

    const drained = await memory.jobs.drain();
    const committed = await memory.jobs.getJob({ jobId: queued.jobId });

    expect(drained.jobs[0]?.status).toBe("succeeded");
    expect(committed?.status).toBe("succeeded");
    expect(committed?.lastError).toBeUndefined();
    expect(committed?.linkedMemoryIds).toEqual([]);
    expect(committed?.linkedEvidenceIds).toEqual([]);
  });

  it("returns a machine-readable error for idempotency conflicts", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });
    const first = await memory.jobs.enqueueRemember({
      scope: { userId: "conflict-user", sessionId: "conflict-session" },
      messages: [
        {
          role: "user",
          content: "Remember that conflict jobs keep the first payload.",
        },
      ],
      idempotencyKey: "conflict-turn-1",
    });

    await expect(
      memory.jobs.enqueueRemember({
        scope: { userId: "conflict-user", sessionId: "conflict-session" },
        messages: [
          {
            role: "user",
            content: "Remember that conflict jobs must reject a different payload.",
          },
        ],
        idempotencyKey: "conflict-turn-1",
      }),
    ).rejects.toMatchObject({
      code: "idempotency_conflict",
    });

    const original = await memory.jobs.getJob({ jobId: first.jobId });
    expect(original?.status).toBe("queued");
    expect(original?.lastError).toBeUndefined();
  });

  it("scopes idempotency keys so ordinary turn ids can repeat across users", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });
    const first = await memory.jobs.enqueueRemember({
      scope: { userId: "jobs-scope-user-1", sessionId: "jobs-scope-session" },
      messages: [
        {
          role: "user",
          content: "Remember that user one has a scoped background job.",
        },
      ],
      idempotencyKey: "turn-1",
    });
    const second = await memory.jobs.enqueueRemember({
      scope: { userId: "jobs-scope-user-2", sessionId: "jobs-scope-session" },
      messages: [
        {
          role: "user",
          content: "Remember that user two has a different scoped background job.",
        },
      ],
      idempotencyKey: "turn-1",
    });

    expect(second.jobId).not.toBe(first.jobId);
    expect(first.idempotencyKey).toBe("turn-1");
    expect(second.idempotencyKey).toBe("turn-1");
  });
});
