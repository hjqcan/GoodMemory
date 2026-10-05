# GoodMemory Reference Integration Guide

This is the canonical packaged `0.8.3` reference path for chatbox/copilot-style
integration. Registry commands require publication; source verification uses
the local tarball path below.

## Install

Published install:

```bash
npm install goodmemory@0.8.3
```

Bun install:

```bash
bun add goodmemory@0.8.3
```

Tarball verification of the same release artifact before publish:

```bash
npm install ./goodmemory-0.8.3.tgz
```

## Quick Path

For a normal Node HTTP service, start with the canonical 15-minute guide:
`docs/GoodMemory-15-Minute-App-Integration.md`. It shows the current app loop
with `memory.runtime.*`, `recall`, `buildContext`,
`memory.jobs.enqueueRemember()`, targeted `reviseMemory()`, and `traceSink`.

1. Install the package with npm or Bun and keep the default public runtime entrypoint: `createGoodMemory({})`
2. Use the Express or Fastify examples when you want a minimal Node route
   around the current memory loop.
3. Accept normal `ModelMessage[]` input plus a scoped `userId` / `workspaceId` / `sessionId`.
4. Use `createGoodMemoryAISDK(...)` when your server already standardizes on
   AI SDK streaming.
5. For repo-local comparison only, run the reference example:
   `bun run example:ai-sdk-server`

## Canonical Integration

```ts
import { createGoodMemory } from "goodmemory";
import type { GoodMemoryStreamTextInput } from "goodmemory/ai-sdk";
import { createGoodMemoryAISDK } from "goodmemory/ai-sdk";

const memory = createGoodMemory({});

const aiSDK = createGoodMemoryAISDK({
  memory,
});

type MemoryChatRequest = Pick<
  GoodMemoryStreamTextInput,
  "messages" | "query" | "scope" | "system"
>;

function isMemoryChatRequest(value: unknown): value is MemoryChatRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const scope = candidate.scope;
  return Array.isArray(candidate.messages)
    && !!scope
    && typeof scope === "object"
    && !Array.isArray(scope)
    && typeof (scope as { userId?: unknown }).userId === "string"
    && (scope as { userId: string }).userId.trim().length > 0;
}

export async function handleMemoryChat(request: Request): Promise<Response> {
  const body: unknown = await request.json();
  if (!isMemoryChatRequest(body)) {
    return new Response(
      JSON.stringify({
        error: "Expected a request body with a messages array and scope.userId.",
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 400,
      },
    );
  }

  const result = aiSDK.streamText({
    messages: body.messages,
    query: body.query,
    scope: body.scope,
    system: body.system,
    model: {} as never,
  });

  return result.toTextStreamResponse();
}
```

Next.js mapping:

- `export async function POST(request: Request)` can delegate directly to the same handler body.
- For ordinary Node HTTP services, prefer the thin route examples:
  `examples/express-chat-server.ts` and `examples/fastify-chat-server.ts`.
- The repo-local AI SDK example is `examples/plain-ai-sdk-server.ts`.
- `examples/vercel-ai-chat.ts` remains as the lower-level wrapper-first example.
- The HTTP boundary should reject malformed `scope` input instead of silently soft-failing memory semantics.

### Concurrent memory writes

Built-in SQLite facades sharing the same resolved database path coordinate the
short projection-manifest commit window within one process and module instance.
Different durable scopes use different queues; extraction, model calls, and
projection synchronization run outside this window. Each queued waiter has a
30-second acquisition limit and is removed without executing when that limit is
reached. Once a storage commit starts, it is allowed to finish; timing out an
active write would make its outcome uncertain.

Caller snapshots, ownership conditions, source checks, and projection-validation
conditions still apply. A queue is an admission aid, not a replacement for atomic
storage checks or a promise that conflicting writes always succeed. Distinct
in-memory databases and separate files do not share queues. Relative paths and
symbolic links are resolved after the SQLite database opens; arbitrary hard-link
aliases, renames, independent module copies, and separate processes are outside
this coordination boundary. Custom adapters coordinate only when they reuse the
same documentStore object instance. No new custom-adapter capability is required.

SQLite vector upserts with records and vector deletes acquire writer admission
before reading vector identity. This avoids upgrading a stale deferred read
snapshot after another process commits. The existing one-second SQLite busy
timeout applies at admission; that wait is synchronous, and sustained contention
can still return `SQLITE_BUSY`. Batch rollback, vector-index updates and all
canonical source conditions are unchanged. Empty upserts keep their existing
non-writing initialization behavior, including the read-only rejection.

Cold connection setup also applies the existing one-second budget when enabling
WAL mode. That SQLite operation can bypass the native busy handler, so only its
`SQLITE_BUSY` and competing-recovery `SQLITE_BUSY_RECOVERY` failures are retried
with short synchronous waits under one shared deadline. Other codes, including
`SQLITE_BUSY_SNAPSHOT`, are not retried here. A persistent
lock or other setup error remains visible, and a connection whose journal/timeout
setup fails is closed. Read-only and in-memory connections keep their prior path.
The budget covers WAL retries and waits, not every setup or schema operation.
This does not add retries to memory writes or change the host's error recovery.

The two/four-process, sixteen-writes-per-process regression now runs in the
canonical suite; the original
`bun test ./scripts/diagnostics/sqlite-concurrent-remember.test.ts` command remains
available. These bounded checks do not promise arbitrary-process fairness,
unlimited contention tolerance or atomic canonical-and-vector deletion.
Hosts should inspect memory writeback results independently of successful chat
responses. This coordination is included in the 0.8.3 release source; registry
consumers receive it only after publication.

### Observation summaries and source validity

The opt-in observation synthesis job stores source IDs and versioned input
fingerprints with each generated summary. This support metadata is excluded from
search and reranking text; the projection pipeline version rebuilds older
indexes under that rule. It commits only while every input and
the target still match the exact snapshots captured before generation. A missing,
modified, inactive, superseded, expired, or differently scoped source makes the
summary unavailable for current recall. The built-in writer records its actual
generation inputs. Fingerprints check consistency with current stored sources;
they do not verify a generated statement or grant additional access.

Current use validates the summary and all required sources together with an
atomic no-op conditional batch. Checks occur before recall policy callbacks,
follow-up generation, reranking, and final context, and before the applicable
maintenance/import embedding and retrieval-cue calls. Policy callbacks receive
cloned records. A historical query timestamp cannot revive expired support.
A request already sent while its support was valid cannot be retracted later.
These checks do not make every ordinary fact read globally serializable.

Legacy summaries containing only member IDs are retained for export/audit but
withheld from current use until regenerated by observationSynthesis. This can
reduce recall temporarily. Upgrade all readers and writers sharing the store;
older runtimes do not enforce these checks. This is not physical erasure from canonical storage,
raw history, earlier prompts, logs, exports, or backups. A source deletion does
not authorize arbitrary deletion of unrelated records.

Adapters without atomic multi-source validation withhold these derived records.
Built-in read-only adapters reject the conditional primitive even when its write
set is empty, so they also withhold observations; this new filter leaves ordinary facts unchanged.
On SQLite the no-op check briefly acquires an immediate transaction, which can
contend with writers. The operation changes no records. Generation supports at
most 1,024 source facts per summary; a validation batch reads at most 4,096
records. Malformed, nested, cyclic, over-budget, and unsupported dependency
metadata fails closed. Nested derivations are not enabled by this feature.

### Runtime Kit temporal handoff

Hosts using `goodmemory/runtime-kit` directly should carry the anchor returned
by `beforeModelCall` into the matching `afterModelCall`. The runtime kit does
not associate turns by scope because multiple model calls in one scope can run
concurrently.

```ts
import { createGoodMemoryRuntimeKit } from "goodmemory/runtime-kit";

const runtimeKit = createGoodMemoryRuntimeKit({ memory });
const before = await runtimeKit.beforeModelCall({
  scope,
  messages,
  timezone: "America/New_York",
});

const answer = await callModel({
  messages,
  system: before.context.content,
});

await runtimeKit.afterModelCall({
  scope,
  messages,
  assistantText: answer,
  referenceTime: before.referenceTime,
  timezone: before.timezone,
  writeback: { mode: "observe" },
});
```

Only the latest user message receives the returned `referenceTime` as an
`observedAt` fallback. Historical messages are never backfilled; callers may
set message-level `observedAt` and `timezone` when those values are already
known.

## Stable Contract

- `goodmemory`, `goodmemory/ai-sdk`, `goodmemory/host`, and `goodmemory/http` now resolve through compiled package artifacts on both Node and Bun.
- Domain-specific writes should use `createGoodMemory({ remember: ... })` with public profiles, rules, custom extractors, and annotations.
- `testing.extractor` is not a product integration surface; it remains available for tests.
- `remember` profiles differ from `retrievalProfile`: remember profiles control what gets written, while retrieval profiles control recall routing and context assembly.
- Domain rules differ from `policy` hooks: rules generate normal candidates before classification, evidence, conflict handling, vector writes, and rollback; policy hooks remain governance gates after candidates exist.
- The canonical deterministic path uses the accepted Phase 26 local-first runtime and the accepted Phase 28 supported local acceleration behavior.
- Bun keeps the local SQLite default runtime path; Node zero-config runtime currently falls back to in-memory when the built-in local SQLite adapter is unavailable.
- No embedding environment variables means the runtime stays `rules-only`.
- Tarball and registry installability are both valid package-boundary paths for this package line.
- The reference path should use only:
  - `goodmemory`
  - `goodmemory/ai-sdk`
  - `goodmemory/host`
  - `goodmemory/http`

## What This Guide Proves

- public imports are enough for the reference integration path
- the default runtime can stand up a working memory loop without repo-internal imports
- the canonical public path is a plain AI SDK server that returns `Request -> Response` through `toTextStreamResponse()`
- the AI SDK wrapper can augment recall and remember on the public surface
- the same public surface is installable from the packed release artifact or from registry install, not only from a repo checkout

## Domain Write Profiles

A server-side agent can declare domain write behavior without forking the core
extractor. OneLife and life-coach agents are motivating examples, but they are
not built-in presets.

```ts
import { createGoodMemory, rememberRules } from "goodmemory";

const memory = createGoodMemory({
  remember: {
    profiles: [
      {
        id: "life-coach",
        when: { agentId: "life-coach" },
        rules: [
          rememberRules.fact(/my top priority this quarter is (.+)/i, {
            id: "life-goal-priority",
            category: "goal",
            tags: ["life_coach", "long_term_goal"],
            attributes: { horizon: "quarter" },
            content: ({ match }) => match[1] ?? "",
          }),
          rememberRules.preference(/please coach me with (.+)/i, {
            id: "life-coaching-style",
            category: "coaching_style",
            value: ({ match }) => match[1] ?? "",
          }),
        ],
        assistantOutputs: { mode: "confirmed_or_verified_only" },
      },
    ],
  },
});
```

Host annotations should be used for explicit write intent:

- `remember: "never"` suppresses the annotated message before deterministic, custom, or assisted extraction.
- `remember: "always"` can raise a valid low-confidence candidate through normal classification and policy; it does not bypass redaction or policy hooks.
- `metadataPatch`, `kindHint`, `confirmed`, `verified`, and `reason` are preserved in remember traces so audit output can explain why a write changed.

Custom domain extractors should use the named profile form when trace stability
matters:

```ts
extractors: [
  {
    id: "life-coach-values-extractor",
    extractor: {
      async extract(input) {
        return {
          candidates: [],
          ignoredMessageCount: 0,
        };
      },
    },
  },
],
```

The raw `MemoryExtractor` array form remains supported for compatibility; the
named form keeps `extractorIds` stable across profile reordering and replayed
evals. Named extractor ids are audit identities: they must be non-blank and
unique in the resolved profile, and they cannot use the generated
`${profileId}:extractor-N` raw-extractor namespace.
Remember events carry the resolved `profileId` and `presetId` for default
preset, rules, custom extractor, assisted-only, and annotation-derived writes.

Storage guidance stays deployment-dependent:

- in-memory storage is for tests and short-lived demos
- SQLite is acceptable for local and single-writer deployments
- Postgres is recommended for multi-instance production

For Python backends or Expo clients, keep GoodMemory on the server side as a
Node/Bun sidecar or service. The mobile/client app should call the server API;
it does not need GoodMemory bundled into the client runtime. Python backends can
use the packaged `goodmemory-http-bridge` server or import the TypeScript
bridge API from `goodmemory/http` in a Node/Bun sidecar.
