# LongMemEval-V2 GoodMemory adapter

This is a pre-protocol adapter for the official LongMemEval-V2 harness. It is
not a benchmark claim and is intentionally not registered in
`scripts/research/protocols.json` until a locked run has been completed and
reviewed.

## Locked external inputs

- source: `xiaowu0162/LongMemEval-V2@2cc8c540bdb87fe6761629b585e727e1c4704520`
- dataset: `xiaowu0162/longmemeval-v2@f152293e235517d504809563c833d7190b8c713b`

The adapter uses the current official query-privacy boundary: the backend gets
the question text, optional question image, and an opaque run-local invocation
id. It does not receive question id, question type, reference answer, evaluator,
or aggregate score.

## Mapping

- Each trajectory summary and state is written through the public GoodMemory
  HTTP bridge as an exact, verified fact with `rules-only` extraction.
- A state keeps its URL, action, thought, accessibility tree, and screenshot
  path. Unknown top-level trajectory fields are not serialized.
- Recall uses the configured GoodMemory retrieval profile and strategy.
- Only screenshots named by recalled facts are returned as image context.
- The wrapper forwards the harness's opaque per-question workspace directory;
  the adapter hashes it into the configured workspace namespace so different
  haystacks never share remote GoodMemory state. Trajectory ids stay in fact
  metadata instead of session scope so recall can search the whole locked
  haystack for each question.
- Operational diagnostics go to stderr without logging question text or bridge
  credentials.

The first baseline intentionally does not add an LLM summarizer, benchmark-type
router, answer-aware prompt, or online score feedback. Query-image content is
not embedded by GoodMemory; the official reader still receives the query image,
and the adapter can return recalled trajectory screenshots.

## Run

Download, prepare, and validate the official data on the external disk:

```bash
python /Volumes/data/GoodMemory-research/sources/LongMemEval-V2/data/prepare_data.py \
  --data-root /Volumes/data/GoodMemory-research/datasets/longmemeval-v2
python /Volumes/data/GoodMemory-research/sources/LongMemEval-V2/data/validate_data.py \
  --data-root /Volumes/data/GoodMemory-research/datasets/longmemeval-v2 \
  --tier small
python /Volumes/data/GoodMemory-research/sources/LongMemEval-V2/data/validate_data.py \
  --data-root /Volumes/data/GoodMemory-research/datasets/longmemeval-v2 \
  --tier medium
```

At the locked revisions above, both validation commands pass with 451
questions and 1,870 trajectories. The prepared directory occupies 13 GiB.

Start a GoodMemory HTTP bridge backed by a neural embedding provider and an
explicit semantic candidate-generation path (`retrieval.preset="recommended"`
or `retrieval.semanticCandidates`). A hybrid strategy without that candidate
path can only rerank facts already admitted by lexical selection, which is not
an adequate baseline for long accessibility trees. Copy
`memory-config.example.json` outside the repository, and replace
`workspace_id` with a unique value for the exact tier, domain, source commit,
and candidate. This value is the run namespace; the adapter appends a stable
hash of the official opaque per-question workspace. Never reuse a run namespace
across candidates.

Then invoke the official runner through the registration wrapper:

```bash
python scripts/research/longmemeval-v2/run_goodmemory.py \
  --upstream-root /Volumes/data/GoodMemory-research/sources/LongMemEval-V2 \
  --goodmemory-config /path/to/locked-goodmemory-config.json \
  --data-root /Volumes/data/GoodMemory-research/datasets/longmemeval-v2 \
  --domain web \
  --tier small \
  --method goodmemory \
  --output-dir /Volumes/data/GoodMemory-research/runs/<run-id> \
  <official reader and evaluator arguments>
```

Run web and enterprise with separate fresh scopes. Preserve the config, source
and dataset revisions, GoodMemory commit, bridge environment descriptor, Bun
version, official output, and checksums together before interpreting a score.
