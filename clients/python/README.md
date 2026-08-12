# goodmemory-client

Official Python client for the [GoodMemory](https://github.com/hjqcan/GoodMemory)
HTTP bridge. Stdlib only — no third-party dependencies. Wire contract:
`phase-39.http-memory.v1`.

Deploy the bridge (Node/Bun sidecar or Docker; see the
[bridge guide](https://github.com/hjqcan/GoodMemory/blob/main/docs/GoodMemory-Python-HTTP-Integration-Bridge.md)),
then:

```bash
pip install goodmemory-client
```

```python
from goodmemory_client import GoodMemoryClient, Scope

client = GoodMemoryClient(
    "http://127.0.0.1:8739",
    token="your-bridge-token",
    scope=Scope(user_id="u-1", workspace_id="workspace-a", session_id="s-1"),
)

client.wait_until_ready()

# Before your model call
recall = client.recall_context(
    "What happened yesterday?",
    reference_time="2026-11-01T05:30:00.000Z",
    timezone="America/New_York",
)
print(recall.context_text)
# routing shows silent strategy downgrades (e.g. hybrid -> rules-only when no
# embedding provider is configured on the bridge)
print(recall.routing.resolved_strategy, recall.routing.fallback_reason)

# After the response
client.remember([
    {"role": "user", "content": "Remember that the rollout is blocked on QA signoff."},
], observed_at="2026-11-01T05:29:00.000Z", timezone="America/New_York")

# Corrections, audit, deletion
client.feedback("Keep summaries short.", idempotency_key="fb-1")
export = client.export()
client.revise(memory_id="<memory-id>", content="corrected fact",
              reason="user correction", idempotency_key="rev-1")
client.forget("<memory-id>")
```

Notes:

- Caller headers (`x-goodmemory-*`) are derived from the `Scope` you pass —
  the bridge requires the header caller and body scope to match. Per-call
  `scope=` overrides re-derive them.
- `operations` defaults to `"*"`; pass an explicit list (e.g.
  `["recall-context", "remember"]`) for least privilege — `export`, `forget`,
  and `revise` are sensitive operations the bridge authorizes individually.
- Idempotency keys mirror the server: always required for `feedback` and
  `revise`, required for `remember(mode="async")` only.
- `reference_time` anchors recall for a historical turn. `observed_at` applies
  to the latest message in `remember(...)`; `timezone` is an IANA zone passed
  through to GoodMemory. Explicit message-level `observedAt` still wins.
- Bridge errors raise `GoodMemoryBridgeError` with `.code`, `.status`, and
  `.body`; connection failures retry, HTTP-status errors never do (a 409
  `idempotency_conflict` surfaces immediately).
