# GoodMemory Inspector And Admin API

GoodMemory Inspector is the local operator surface for durable memory. It is a
private React/Vite application compiled into the `goodmemory` package and
served by the existing CLI process; React is not a GoodMemory runtime
dependency.

## Start

```bash
goodmemory inspector serve
goodmemory inspector serve --storage-url .goodmemory/goodmemory.sqlite
```

The service binds only `127.0.0.1`. Startup prints a URL whose token is in the
`#token=` fragment. The browser moves that token to `sessionStorage` and clears
the fragment immediately. Admin requests authenticate only with
`Authorization: Bearer`; query-string and JSON-body tokens are not accepted.
The service does not enable CORS or display raw transcripts.

## Operator Workflows

The Inspector provides:

- user and scope discovery with explicit `complete` or `partial` catalog
  coverage;
- categorized memory inspection, lifecycle history, and supersession lineage;
- candidate approval, rejection, and release;
- governed revision, forget, memory deletion, and whole-scope deletion;
- recall candidate, fusion, reranker, and evidence traces;
- mutation audit events.

Candidate approve/reject actions execute directly. Revision, forget, memory
deletion, and scope deletion require a target summary and explicit
confirmation. Mutations use ETags and `If-Match` to reject stale operator state,
plus `Idempotency-Key` for retry-safe execution.

## Admin API

The versioned API prefix is `/admin/v1`.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/scopes` | List discovered scopes and memory counts. |
| `GET` | `/scopes/{scopeKey}/memories` | List categorized memory for one exact scope. |
| `GET` | `/candidates` | List review candidates. |
| `PATCH` | `/candidates/{id}` | Apply `pending -> approved/rejected` or `approved -> released`. |
| `POST` | `/scopes/{scopeKey}/memories/{id}/revisions` | Supersede revisable memory. |
| `DELETE` | `/scopes/{scopeKey}/memories/{id}` | Forget one exact-scope memory. |
| `DELETE` | `/scopes/{scopeKey}` | Delete all memory in one confirmed scope. |
| `POST` | `/recall-traces` | Run a scoped recall diagnostic. |
| `GET` | `/audit-events` | List Inspector mutation audit events. |

Lists default to 50 rows and cap at 200. Pagination cursors use stable storage
ordering. Errors use one shape:

```json
{
  "error": {
    "code": "machine_readable_code",
    "message": "Operator-facing explanation",
    "requestId": "req_..."
  }
}
```

### Data exposure

An export is the whole durable scope. Beyond the visible records it carries
evidence excerpts, the `pages/` note bundle with per-file SHA-256 digests, and
(when requested) runtime summaries. Redaction hides values, not existence: a
redacted export still reveals which records exist, their ids, timestamps, and
content hashes, and a vector index or projection rebuilt from it reveals the
same. Do not distribute exports, the `pages/` bundle, or a workspace file
mirror (`governance.fileMirror`) for scopes whose contents must not leak, and
treat an import's `inputSha256` as an integrity check, not as proof of origin.

## Compatibility Boundary

`goodmemory runtime viewer` is deprecated. It now delegates to the same
Inspector HTTP implementation in exact-scope, read-only mode and prints a
deprecation notice. It has no separate HTML shell, route dispatcher, or
mutation surface.

This release does not add hosted accounts, remote RBAC, billing, cloud sync, or
a multi-tenant control plane. The Inspector is a local trust and governance
surface over the configured GoodMemory store.
