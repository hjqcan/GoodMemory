# GoodMemory 15-Minute App Integration

This guide is the canonical quick path for adding GoodMemory to a normal
server-side chat, copilot, or product-agent loop.

Use it when your application owns the request, session lifecycle, model call,
auth, and UI, and GoodMemory should provide scoped memory recall, context
assembly, governed writes, corrections, audit, and deletion.

## Install

The registry commands below apply after `goodmemory@0.7.0` is published. Before
publication, install the verified local `goodmemory-0.7.0.tgz` produced by the
release workflow.

```bash
npm install goodmemory@0.7.0
```

Bun services can use the same package:

```bash
bun add goodmemory@0.7.0
```

## The Loop

The app owns the turn. GoodMemory supplies memory before the model call and
records selected signals after the response.

```ts
import type { GoodMemoryTraceSpan, MemoryScope } from "goodmemory";
import { createGoodMemory, scopeToKey } from "goodmemory";

const traceSpans: GoodMemoryTraceSpan[] = [];

const memory = createGoodMemory({
  observability: {
    traceSink: {
      emit(span) {
        traceSpans.push(span);
      },
    },
  },
});

const startedSessions = new Set<string>();
const startingSessions = new Map<string, Promise<void>>();

async function ensureSessionStarted(scope: MemoryScope): Promise<void> {
  const key = scopeToKey(scope);
  if (startedSessions.has(key)) {
    return;
  }

  const existingStart = startingSessions.get(key);
  if (existingStart) {
    await existingStart;
    return;
  }

  const start = memory.runtime
    .startSession({ scope })
    .then(() => {
      startedSessions.add(key);
    })
    .finally(() => {
      startingSessions.delete(key);
    });
  startingSessions.set(key, start);
  await start;
}

async function handleChatTurn(input: {
  message: string;
  scope: MemoryScope;
  turnId: string;
}) {
  await ensureSessionStarted(input.scope);

  await memory.runtime.appendMessage({
    scope: input.scope,
    message: {
      role: "user",
      content: input.message,
    },
  });

  const recall = await memory.recall({
    scope: input.scope,
    query: input.message,
    retrievalProfile: "general_chat",
  });
  const context = await memory.buildContext({
    recall,
    output: "system_prompt_fragment",
  });

  const assistantText = await callYourModel({
    memoryContext: context.content,
    userMessage: input.message,
  });

  await memory.runtime.appendMessage({
    scope: input.scope,
    message: {
      role: "assistant",
      content: assistantText,
    },
  });

  const job = await memory.jobs.enqueueRemember({
    scope: input.scope,
    messages: [
      {
        role: "user",
        content: input.message,
      },
      {
        role: "assistant",
        content: assistantText,
      },
    ],
    idempotencyKey: input.turnId,
    reason: "post_response_memory_write",
  });
  const drained = await memory.jobs.drain({ maxJobs: 1 });
  const committedJob =
    drained.jobs.find((drainedJob) => drainedJob.jobId === job.jobId) ?? job;

  return {
    assistantText,
    contextEstimatedTokens: context.estimatedTokens,
    traceCount: traceSpans.length,
    writeJob: {
      jobId: committedJob.jobId,
      linkedEvidenceIds: committedJob.linkedEvidenceIds,
      linkedMemoryIds: committedJob.linkedMemoryIds,
      status: committedJob.status,
    },
  };
}

async function callYourModel(input: {
  memoryContext: string;
  userMessage: string;
}): Promise<string> {
  void input.memoryContext;
  return `I will use the relevant memory while answering: ${input.userMessage}`;
}
```

Call `memory.runtime.startSession` when your product opens a new session. Do
not call it unconditionally on every turn for the same `sessionId`; use an
app-level session registry, `memory.runtime.getState`, or your product session
store to avoid resetting active runtime state.

`memory.jobs.enqueueRemember` creates an auditable queued write. This
in-memory scheduler commits jobs when `memory.jobs.drain` runs. In production,
run draining in a worker or request-adjacent job loop and surface failed jobs
instead of hiding them.

`GoodMemoryConfig.observability.traceSink` receives redaction-safe spans for the
public memory API and job flow. Store span ids, names, statuses, and links in
your product telemetry if you need to explain why GoodMemory remembered,
recalled, blocked, revised, forgot, or exported something.

## Corrections

Corrections are targeted. Persist the `memoryId` you show in an audit UI or
retrieve it from `exportMemory()` before revising.

```ts
await memory.reviseMemory({
  scope,
  target: { memoryId: "fact_123" },
  revision: {
    content: "The migration rollout is blocked on security approval.",
  },
  reason: "user_correction",
  evidence: {
    source: "user_message",
    excerpt: "Actually it is blocked on security approval, not QA.",
  },
  idempotencyKey: "correction-turn-17",
});
```

Do not auto-select a correction target from free text. The supported correction
path is explicit `target: { memoryId }`.

## Audit, Forget, And Export

```ts
const exported = await memory.exportMemory({
  scope: {
    userId: "u-1",
    workspaceId: "workspace-a",
  },
  includeRuntime: true,
});

await memory.forget({
  scope,
  memoryId: exported.durable.facts[0]?.id ?? "fact_123",
});
```

Use `exportMemory()` for user-visible audit and portability. Use
`memory.forget()` when a specific memory is wrong, obsolete, or user-deleted.

## Runtime Archive Boundary

Raw transcripts are not the default memory source. Runtime archive persistence
is off by default, and you can be explicit at session end:

```ts
await memory.runtime.endSession({
  scope,
  archive: "off",
});
```

If your product opts into archive persistence, keep it summary-only. Archive
records are continuity substrate, not a raw transcript store.

## Recommended Server Paths

For Node services, start from the thin route examples:

- [examples/express-chat-server.ts](../examples/express-chat-server.ts)
- [examples/fastify-chat-server.ts](../examples/fastify-chat-server.ts)

Those examples are thin route adapters around the request-adjacent pieces of
the same loop. They let `appendMessage` initialize state when needed; if your
product has an explicit session-open event, call `memory.runtime.startSession`
there instead of every turn.

- `memory.runtime.appendMessage`
- `memory.recall`
- `memory.buildContext`
- `memory.jobs.enqueueRemember`

For Python/FastAPI backends, keep GoodMemory server-side through the packaged
`goodmemory-http-bridge` server or the `goodmemory/http` bridge API in a
Node/Bun sidecar. The Python path should call the bridge over authenticated
backend HTTP; it should not bundle GoodMemory into a mobile or browser client.

## Production Defaults

- Use scoped `userId`, `workspaceId`, and `sessionId` consistently.
- Use `idempotencyKey` for every background remember job.
- Surface `writeJob.status` or retry failures instead of hiding write errors.
- Keep assistant-originated durable memory behind your product policy.
- Use Postgres for multi-instance deployments.
- Keep exported artifact files as projections, not canonical storage.
