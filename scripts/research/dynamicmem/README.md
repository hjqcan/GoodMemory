# DynamicMem GoodMemory adapter

This directory integrates GoodMemory with the official DynamicMem Temporal
Checkpoint Evaluation runner without modifying the upstream checkout. It is a
research/protection protocol, not a package API or a current benchmark claim.

Locked inputs used by the source audit:

- DynamicMem source:
  `wenyaxie023/DynamicMem@622c98d70f13cfb855a80263b5caa3fd790715bf`
- DynamicMem dataset:
  `xiewenya/dynamicmem@cc811d0c2273742f6af4cb20ffee4ffacb51935c`

Keep both outside this repository. Prefer the external data disk for the
dataset and prediction/evaluation artifacts.

The 2026-08-22 local preflight downloaded 10 users, 17,715 raw app logs, and
50 checkpoints. Every checkpoint index matched its declared `app_log_id`, and
each user's five indices were strictly increasing. All 3,648 published
retrieval-query fields were non-empty. The upstream ground-truth
verifier cannot be replayed from this consumer release because it expects
construction-time `golden_evidence` in `app_logs_final.json`; the published
directories contain `app_log_large.json` and `task_packs.json`. Do not interpret
that missing construction artifact as a passed gold-state integrity check.

## Privacy and time boundary

The published `task_packs.json` contains gold/reference state, scoring points,
and gold evidence ids. The upstream adapter API also passes the complete
checkpoint object to a backend callback. The GoodMemory wrapper deliberately
narrows that callback to checkpoint id/time/app-log id and sequential raw app
logs. It never passes validated state, reference answers/outputs, scoring
points, gold evidence ids, or future logs to the GoodMemory bridge.

Every run receives an opaque workspace suffix derived from the prediction
output directory, and every benchmark user receives a separate workspace.
Checkpoint ingestion must be a monotonic full-history prefix. Resume and
sliding `max_visible_logs` runs fail closed because neither can prove that the
remote memory state matches the prediction artifact.

Each raw app log is retained losslessly as an exact verified fact with its
`app_log_id` lineage. The adapter also writes a
`dynamicmem-app-log-id:<id>` tag so assisted facts keep evaluable lineage on the
public HTTP recall surface; the runner converts only those tags into the
upstream `retrieved_app_log_ids` field. This is source lineage, not a gold id.
The configured assisted extractor may derive profile/preference/fact
candidates. Recall receives the checkpoint timestamp as `referenceTime`. The
answer model sees only the upstream gold-free question, blank output shape, and
recalled GoodMemory context.

The locked corpus uses timezone-free `YYYY-MM-DD HH:MM:SS` timestamps and does
not declare a timezone. The adapter maps that exact clock coordinate to
RFC 3339 `Z` for the GoodMemory API and preserves the original timestamp in the
lossless payload. Timezone-aware RFC 3339 inputs pass through unchanged.

## Prepare

Clone and lock the source, then download the locked dataset revision:

```bash
git clone https://github.com/wenyaxie023/DynamicMem.git /Volumes/data/GoodMemory-research/DynamicMem
git -C /Volumes/data/GoodMemory-research/DynamicMem checkout 622c98d70f13cfb855a80263b5caa3fd790715bf
hf download xiewenya/dynamicmem \
  --repo-type dataset \
  --revision cc811d0c2273742f6af4cb20ffee4ffacb51935c \
  --local-dir /Volumes/data/GoodMemory-research/DynamicMem-data
```

Install the upstream environment and start a fresh GoodMemory HTTP bridge with
SQLite on a fast local disk. Assisted extraction and semantic recall must be
enabled. Set the bridge token plus the independent answer-model credentials;
the example uses the project-pinned non-judge model and endpoint:

```bash
export GOODMEMORY_BRIDGE_TOKEN=...
export OPENAI_API_KEY=...
export OPENAI_BASE_URL=https://ai.gurkiai.com/v1
```

Copy both example configs to a run-specific external directory and edit paths,
scope labels, and secrets there. Do not put credentials in either config.

## Run

First verify the wrapper and upstream config without model or bridge calls:

```bash
PYTHONPATH=clients/python:scripts/research/dynamicmem \
python3 scripts/research/dynamicmem/run_goodmemory.py \
  --upstream-root /Volumes/data/GoodMemory-research/DynamicMem \
  --goodmemory-config /path/to/memory-config.json \
  --config /path/to/dynamicmem-config.yaml \
  --dry-run
```

Then run a new one-user, one-checkpoint pilot by adding `--max-checkpoints 1`.
Use a new output directory and fresh GoodMemory database. If privacy,
checkpoint isolation, routing, provider usage, and cost preflights pass, remove
that limit for the sealed one-user pilot. Do not run all ten users or tune core
behavior from the pilot before the independent protection review.

Score predictions with the locked upstream evaluator. Keep evaluator model and
credentials independent from GoodMemory extraction and answer generation.
Report State Completion, Personalized Service, retention, update, evidence
recall, latency, provider calls, and rendered context size separately.

## 2026-08-22 diagnostic pilot

A fresh one-user, one-checkpoint diagnostic used the locked source/data above,
GoodMemory `55949f69f7586427c51ba70762ffd2e90667b6e8` plus the scoped SQLite
WAL/busy-timeout fix, `gpt-5.6-terra` configured for assisted extraction and
answer generation, and `text-embedding-3-small` for semantic retrieval. No
judge ran.

Two adapter contract bugs failed before any model call or write and were fixed
test-first: the corpus timestamp was not valid RFC 3339 for the HTTP API, and
the adapter used `assisted` instead of the public extraction enum
`llm-assisted`. The retry persisted all 180 visible logs in 12 batches,
producing 262 facts. SQLite stayed in WAL mode and returned
`integrity_check=ok`. Buffered bridge logs recovered at shutdown then proved
that all 12 assisted-extraction calls hit the 45-second gateway timeout and the
engine preserved rules-only extraction. This invalidates the run as an
assisted-extraction pilot even though exact-source persistence completed.

The adapter previously ignored the response's
`assisted_extraction_failed` warning and `resolvedExtractionStrategy`; it now
fails closed whenever requested `llm-assisted` resolves to anything else. A
degraded batch may already have committed exact source facts, so the error
requires a new database and workspace. Batch-start, batch-commit, and degraded
batch logs record ids, counts, strategy, warnings, and elapsed time but never
payload content.

All 30 published State Completion queries returned context through
`hybrid -> hybrid` with no fallback. Recall latency was about 1.11 seconds at
the median and 2.01 seconds at p95; item count was 7–10. Rendered context had a
5,990-character median and a 6,000-character p95/max. The 6,000 boundary is the
repository's tested recall-plan hard byte cap; the adapter's larger per-call
`max_tokens` cannot raise it.

An offline lineage diagnostic joined recalled fact ids to their persisted
`appLogId` attributes only after retrieval, then applied DynamicMem's published
per-key macro evidence formula. On this single degraded rules-only checkpoint
it measured evidence
precision 0.1165, recall 0.2623, and F1 0.1390; 15 of 30 keys retrieved none of
their gold evidence. This is a useful retrieval-loss signal, but it is not a
benchmark score: the old run did not yet contain the new lineage tags, the join
used local SQLite, assisted extraction failed, and no answers or judge were
completed.

Answer generation added a second provider blocker after the degraded ingestion.
The first of 30 keys took 29:05: the first provider attempt ended in a
connection error and the second succeeded. The run was deliberately stopped
after 1/30 predictions, leaving `_checkpoint_complete=false`. The incomplete
artifact must not be sent to the evaluator or cited as a DynamicMem result.
Before a sealed pilot, use a stable endpoint for both assisted extraction and
answers or add explicit outer timeout/cancellation boundaries, then start from
a new database and scope.

A bounded follow-up tested whether the 16-message batch size caused the
extraction failure. One raw app log in a fresh scope with `batch_size=1` still
did not return before a 90-second client timeout. The owned bridge was stopped;
its temporary database contained only the in-flight scope-mutation intent and
no canonical documents. Reducing batch size alone is therefore not a supported
remedy for this endpoint.

## Local contract tests

```bash
PYTHONDONTWRITEBYTECODE=1 \
PYTHONPATH=clients/python:scripts/research/dynamicmem \
python3 -m unittest scripts/research/dynamicmem/tests/test_goodmemory_backend.py

bun test tests/integration/dynamicmem-goodmemory-adapter.test.ts
```
