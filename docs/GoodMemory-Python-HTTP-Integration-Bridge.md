# GoodMemory Python HTTP Integration Bridge

This document freezes the Phase 39 reference contract for calling GoodMemory
from a Python or FastAPI backend through a thin Node/Bun HTTP bridge.

The bridge is a backend-only service boundary. Browser, mobile, and Expo
clients call the product backend. The product backend authenticates the user,
authorizes the scoped operation, applies product memory policy, and then calls
the GoodMemory bridge.

OneLife is the first reference consumer. It is not a built-in GoodMemory
preset. Phase 39 exposes a dedicated `goodmemory/http` package subpath and a
`goodmemory-http-bridge` bin; it does not widen the root `goodmemory` public
API.

## Topology

```text
client app -> Python/FastAPI product backend -> GoodMemory HTTP bridge -> goodmemory public API
```

The public bridge implementation is exported from `goodmemory/http`. The source
lives in `src/http/index.ts`; `examples/support/http-memory-bridge.ts` is only a
compatibility re-export for local examples. The bridge is built only on accepted
public GoodMemory surfaces:

- `recall`
- `buildContext`
- `remember`
- `feedback`
- `forget`
- `exportMemory`
- `reviseMemory`
- `memory.jobs.*`

## Deployment

Installed package usage:

```bash
bun add goodmemory@0.7.0

GOODMEMORY_HTTP_BRIDGE_TOKEN="replace-with-service-token" \
GOODMEMORY_STORAGE_PROVIDER=postgres \
GOODMEMORY_STORAGE_URL="postgres://user:pass@host:5432/goodmemory" \
./node_modules/.bin/goodmemory-http-bridge \
  --host 127.0.0.1 \
  --port 8739 \
  --profile life-coach
```

Local development without a service token is explicit:

```bash
GOODMEMORY_HTTP_BRIDGE_ALLOW_INSECURE=1 \
bun run goodmemory:http-bridge --profile life-coach
```

Production callers should send `Authorization: Bearer <token>` plus the
`x-goodmemory-*` caller headers below. The bridge refuses to start without
`GOODMEMORY_HTTP_BRIDGE_TOKEN` unless `--allow-insecure` or
`GOODMEMORY_HTTP_BRIDGE_ALLOW_INSECURE=1` is set.

The consuming product owns session lifecycle. The bridge does not expose
session lifecycle endpoints by default. If the product uses `memory.runtime.*`,
it should do so only for scoped continuity snapshots or summary-only runtime
state. Raw transcript archive persistence remains off by default.

## Caller Boundary

The reference implementation resolves caller context from internal headers:

- `x-goodmemory-user-id`
- `x-goodmemory-tenant-id`
- `x-goodmemory-workspace-id`
- `x-goodmemory-operations`

Production deployments should normally replace this with product middleware by
passing `resolveCaller` and `authorize` to `createGoodMemoryHttpMemoryBridge`.
The default authorizer is intentionally small:

- caller `userId` must match `scope.userId`
- caller tenant/workspace, when present, must be present in request scope with
  the same value
- request tenant/workspace, when present, must be backed by the caller context
- `export`, `forget`, and `revise` require explicit operation authorization

This is not a public browser API and should sit behind the product backend or
an internal service boundary.

## Common Scope

Every endpoint accepts:

```json
{
  "scope": {
    "userId": "user-123",
    "tenantId": "tenant-a",
    "workspaceId": "workspace-a",
    "agentId": "life-coach",
    "sessionId": "session-1"
  }
}
```

`userId` is required. Tenant, workspace, agent, and session fields are optional
scope refinements. Export, forget, and revise must be authorized against the
same product-owned user and tenant/workspace boundary.

Malformed optional scope fields are rejected. The bridge must not silently drop
an invalid tenant, workspace, agent, or session field and continue with a
broader scope.

## Health Endpoint

`GET /healthz` is the auth-free liveness probe. It answers before the POST
guard, body parsing, and caller resolution, so it needs no token, no
`x-goodmemory-*` headers, and touches no memory data:

```json
{
  "ok": true,
  "status": "ok",
  "contractVersion": "phase-39.http-memory.v1",
  "profile": "default"
}
```

`profile` (and any other extra string field) comes from the bridge's
injectable health metadata; hardened deployments can omit it. Reserved fields
(`ok`, `status`, `contractVersion`) cannot be overridden. Use this endpoint
for Docker `HEALTHCHECK`, load-balancer probes, and client ready-waits.

## Endpoints

### `POST /memory/recall-context`

Request:

```json
{
  "scope": { "userId": "user-123", "workspaceId": "workspace-a" },
  "query": "What should the coach remember about this user?",
  "retrievalProfile": "general_chat",
  "output": "system_prompt_fragment",
  "maxTokens": 1200
}
```

Response:

```json
{
  "ok": true,
  "operation": "recall-context",
  "contractVersion": "phase-39.http-memory.v1",
  "contextText": "User memory context...",
  "context": {
    "output": "system_prompt_fragment",
    "content": "User memory context...",
    "estimatedTokens": 42,
    "omittedSections": []
  },
  "hasContext": true,
  "itemCount": 1,
  "items": [
    {
      "memoryId": "memory-id",
      "type": "fact",
      "content": "Quarterly priority: rebuild sleep routine.",
      "source": "goodmemory",
      "category": "goal",
      "tags": ["life_coach", "goal"]
    }
  ]
}
```

`contextText` is prompt-ready. `items` is a compact structured projection for
consumer response models such as OneLife's memory-context shape.

### `POST /memory/remember`

Request:

```json
{
  "scope": { "userId": "user-123", "workspaceId": "workspace-a", "agentId": "life-coach" },
  "messages": [
    { "role": "user", "content": "My top priority this quarter is rebuilding sleep." }
  ],
  "annotations": [],
  "extractionStrategy": "rules-only",
  "mode": "async",
  "idempotencyKey": "session-1:turn-12"
}
```

`mode` is HTTP transport control only:

- `sync` calls `memory.remember(...)`
- `async` calls `memory.jobs.enqueueRemember(...)`

The bridge does not forward `mode` into `memory.remember()` and does not add a
new `remember({ mode: "background" })` root API.

Async mode is retry-safe through `memory.jobs.*` idempotency. Sync mode returns
the caller idempotency key as consumer provenance only; exactly-once sync
semantics remain product-owned.

Assistant-originated durable writes still require confirmation or verification
through public annotations and profile policy.

### `POST /memory/feedback`

Request:

```json
{
  "scope": { "userId": "user-123", "workspaceId": "workspace-a" },
  "signal": "Use checklist summaries after coaching sessions.",
  "idempotencyKey": "review-42:feedback",
  "source": {
    "system": "onelife",
    "eventId": "review-42",
    "proposalId": "proposal-1",
    "reviewDecision": "accepted"
  }
}
```

This endpoint is for procedural learning signals. It calls
`memory.feedback(...)`; it is not a catch-all fact write. The idempotency key
and source fields are explicit product provenance. The current public
`feedback()` API does not claim bridge-level exactly-once durability, so
products that need replay protection should persist their own review/event
ledger.

### `POST /memory/export`

Request:

```json
{
  "scope": { "userId": "user-123", "workspaceId": "workspace-a" },
  "includeRuntime": false
}
```

`includeRuntime` defaults to `false`. If enabled, runtime output is summary
state only and must not become a raw transcript archive.

### `POST /memory/forget`

Request:

```json
{
  "scope": { "userId": "user-123", "workspaceId": "workspace-a" },
  "memoryId": "visible-memory-id"
}
```

The product must resolve a visible memory target and authorize deletion before
calling the bridge. The bridge does not add an implicit lock or "do not
remember this" mutation.

### `POST /memory/revise`

Request:

```json
{
  "scope": { "userId": "user-123", "workspaceId": "workspace-a" },
  "target": { "memoryId": "visible-memory-id" },
  "revision": { "content": "The user prefers short weekly planning prompts." },
  "reason": "user_correction",
  "evidence": {
    "source": "user_message",
    "message": "Actually, keep those prompts short."
  },
  "idempotencyKey": "review-42:revise"
}
```

`/memory/revise` wraps only the Phase 38 targeted
`reviseMemory({ target: { memoryId } })` path. Query-resolved correction
targets and ambiguous correction requests are rejected by the bridge. Revision
idempotency is handled by the governed revision path and is reported as
`handledBy: "goodmemory_revision"`; it is not a queued `memory.jobs.*` write.

## Consumer Policy Mapping

GoodMemory remains the semantic memory layer. The consuming product owns
product policy and visible user controls.

Recommended mapping for a OneLife-style review flow:

- accepted or edited visible correction -> `POST /memory/revise`
- explicit delete -> `POST /memory/forget`
- procedural coaching preference -> `POST /memory/feedback`
- new durable semantic fact/preference/goal -> `POST /memory/remember`
- lock or "do not remember this" -> product-side policy or masking first
- assistant suggestion -> durable write only after product confirmation or
  verification annotations

Blocked, shame-solidifying, unconfirmed, or locked content should be filtered
before it reaches GoodMemory unless the product has intentionally resolved a
visible target action.

## Life-Coach Write Profile

`createLifeCoachHttpRememberConfig()` in the reference bridge shows a
life-coach scoped profile using public `remember` configuration only:

- stable rule ids
- goal, habit, coaching-style, and intervention-feedback examples
- `assistantOutputs: { mode: "confirmed_or_verified_only" }`
- `when: { agentId: "life-coach" }`

This is reference wiring for consumers. It is not a built-in preset.

## Python Smoke

`examples/python-fastapi-memory-consumer.py` is a minimal Python backend smoke
using standard library HTTP calls. The same calls can sit behind FastAPI route
handlers:

```bash
GOODMEMORY_BRIDGE_URL=http://127.0.0.1:8739 \
GOODMEMORY_BRIDGE_TOKEN="replace-with-service-token" \
python3 examples/python-fastapi-memory-consumer.py
```

The Phase 39 test suite starts both the public bridge API and the packaged
`goodmemory-http-bridge` server, then runs that Python process against them.

## Official Python Client

`pip install goodmemory-client` installs the official stdlib-only client
(package source: `clients/python/` in the goodmemory repository; versioned
independently of the npm package because it tracks the wire contract).

```python
from goodmemory_client import GoodMemoryClient, Scope

client = GoodMemoryClient(
    "http://127.0.0.1:8739",
    token="replace-with-service-token",
    scope=Scope(user_id="user-123", workspace_id="workspace-a"),
)
client.wait_until_ready()
recall = client.recall_context("What should the coach remember?")
```

The client derives the `x-goodmemory-*` caller headers from the `Scope` you
pass (the bridge requires header caller and body scope to agree), mirrors the
per-endpoint idempotency rules (always required for `feedback`/`revise`,
required for async `remember` only), never retries HTTP-status errors (a 409
`idempotency_conflict` surfaces immediately), and exposes `routing` on recall
results so silent `hybrid -> rules-only` downgrades are visible. Bridge errors
raise `GoodMemoryBridgeError` with `.code`, `.status`, and `.body`.

## Docker Deployment

The repo root ships a `Dockerfile` and `docker-compose.yml` for one-command
deployment (Bun base image; SQLite volume at `/app/.goodmemory`; vector
acceleration off so no native libraries are required; health check wired to
`GET /healthz`; the bearer token is never baked into the image):

```bash
GOODMEMORY_HTTP_BRIDGE_TOKEN=replace-with-service-token docker compose up -d
curl -fsS http://127.0.0.1:8739/healthz
```

Postgres (pgvector) profile:

```bash
GOODMEMORY_HTTP_BRIDGE_TOKEN=replace-with-service-token \
GOODMEMORY_STORAGE_PROVIDER=postgres \
GOODMEMORY_STORAGE_URL=postgres://goodmemory:goodmemory@postgres:5432/goodmemory \
docker compose --profile postgres up -d
```

Run-time flags append through the image entrypoint, e.g.
`docker run goodmemory-bridge --profile life-coach`.

## Storage Guidance

SQLite remains acceptable for local development and single-writer deployments.
Postgres remains the recommended production path for multi-instance bridge
deployments. The bridge does not claim cross-service exactly-once transactions
between a product database and GoodMemory storage.
