# Phase 74: Generalized Memory Core Implementation

Status: the engineering pipeline is implemented and verified at candidate
commit `da82e844239cfabc846a1360fe96bcf6e4532acc`. It remains an experimental
profile. Product promotion is not authorized because the required repeated,
cross-benchmark live evaluation and protection gate have not passed.

## Implemented boundaries

- Eval-only answer protocol logic lives in `src/eval/phase74ProtocolReader.ts`.
  Production memory layers are guarded against eval imports and benchmark
  metadata by `tests/unit/architecture.boundaries.test.ts`.
- `src/eval/oracleMatrix.ts` implements the six diagnostic arms with one generic
  reader for the first five arms and a separate eval-only protocol reader for
  the sixth. Every reader input is actually truncated to the frozen 6,000-token
  counter budget; artifacts record pre/post counts and only IDs whose evidence
  is visible. `src/eval/runIdentity.ts` freezes model, dataset, real prompt, and
  configuration identity without persisting API keys or credential-derived
  fingerprints. Rotating an API key therefore does not change experiment
  identity.
- `src/eval/phase74Datasets.ts` adapts the complete pinned LongMemEval-S and
  LoCoMo sources into one label-separated case contract. Retrieval receives
  only the query, scope, reference time, and raw messages; benchmark case,
  session, evidence, and source IDs are replaced with semantic opaque aliases.
  Expected answers, gold evidence, question types, categories, protocol
  metadata, and raw benchmark IDs remain on the evaluation side. Download
  preparation verifies the immutable source
  SHA-256 before creating an output root, then freezes the normalized
  fingerprint, adapted-case digest, selected-case digest, source revision, and
  population counts in a manifest. LoCoMo preparation retains the 1,226 image
  caption turns, strictly normalizes its non-ISO session timestamps to UTC ISO,
  and derives each query reference time from the final session time. Full live
  scopes use only a stable opaque memory-group hash, so family, run ID, case ID,
  and raw conversation labels cannot enter an assisted planner prompt through
  scope metadata.
  The manifest also records unresolved upstream gold-evidence IDs. Gold-based
  oracle arms for those cases are explicitly non-evaluable rather than silently
  scoring missing evidence as a retrieval failure.
- The versioned claim projection keeps source memory, predicate, polarity,
  modality, valid time, observed time, transaction time, immutable evidence
  IDs, and source-message IDs. Projection backfill and repair remain rebuildable
  from canonical records.
- Recall planning is query-only. The deterministic path handles Chinese
  multi-facet queries, explicit time boundaries, current/history/change/count,
  and business-partner disambiguation. The optional provider adapter sends only
  request-local planner input and cannot override the fixed 32/12/6000 budgets.
  `retrieval.recallPlanExecution` is the experimental switch that lets planned
  facets and `maxHops` drive decomposition and iterative retrieval; it remains
  off by default, and per-call `decompose` / `multiHop` values are explicit
  overrides.
- Generalized fusion combines lexical, dense, entity, temporal, and relation
  candidates before global selection. The reranker sees the pre-rank pool and
  can change final membership. Retrieval traces expose the plan, channel
  evidence, selection membership, query executions, hops, and stop reason.
  `retrieval.generalizedFusionChannels` is an experimental E2 ablation hook;
  omitting it keeps all five channels enabled.
- `includeEvidence` adds a typed evidence ledger while the default recall shape
  remains compatible. Current/superseded resolution is scoped by subject and
  predicate; count aggregation does not collapse distinct active values. The
  product `buildContext` path can render prose, chronology, compact JSON, or
  JSON with a generic locale note, and all four formats carry the same typed
  semantic fields before the shared context budget is applied.
- Every provider adapter can emit one model-usage sidecar event per request
  attempt. OpenAI Chat, OpenAI Responses, Anthropic-style cache accounting, and
  AI SDK usage normalize to an authoritative total input, uncached input, cache
  creation/read, and output breakdown without double-counting cache tokens.
  Automatic extraction, embedding, and reranking adapters use the configured
  observability sink; eval answer and judge factories accept separate sinks so
  judge traffic cannot be charged to the candidate branch. Phase 74 appends the
  attributed terminal event with open/write/fsync/close before adding it to the
  in-memory run and before checkpoint commit; a failed strict eval sink fails
  the request. Resume reloads, validates, and preserves the existing JSONL
  instead of replacing it with an empty file. This is durable terminal-event
  accounting, not a pre-request write-ahead protocol.
- The full experimental adapter pins every non-judge language call to
  `gpt-5.6-terra` through the GurkiAI gateway and keeps the independent judge on
  `gpt-5.5`. LongMemEval scoring uses the pinned upstream prompts, but gpt-5.5
  is outside that evaluator's model zoo; the resulting paired accuracy is
  official-prompt-compatible and is not directly comparable to published
  official scores. It verifies that the declared commit equals the actual Git HEAD and
  that the declared source SHA equals a deterministic snapshot of the complete
  `src` TypeScript tree, runner/preparation/aggregation/scale scripts, package
  manifest, and lockfile before a live run may start. Assisted extraction,
  assisted planning, and pointwise reranking respectively freeze 4096, 1024,
  and 256 output tokens at temperature zero. Both OpenAI-compatible and AI SDK
  object paths forward those settings instead of merely recording them.
- File checkpoints are content-addressed and create-only: resume skips only an
  identity-matching committed unit whose payload still hashes correctly, while
  conflicting or tampered commits fail closed. E4 consumes the serialized E3
  EvidenceLedger snapshot rather than rerunning retrieval. E1-E3 checkpoints
  now include the generic-reader answer, independent judgment, family score,
  and exact context-budget measurement, so a resumed retrieval result cannot
  silently lose its end-to-end answer evidence.
- Full ingestion uses a content-addressed SQLite snapshot per benchmark memory
  group and representation. The cache key binds source data, evidence,
  extraction and embedding model/gateway configuration, actual extraction
  prompt SHA, extractor/adapter version, evaluator-source SHA, and
  representation. E2 and E3 therefore reuse the same atomic projection, and
  all questions in one LoCoMo conversation share one extraction pass. Recall
  runs against a copy-on-write clone, so access touches cannot mutate the frozen
  ingestion snapshot or contaminate later arms.
- Full artifacts persist the real RecallPlan, channel and hop candidates,
  eliminations, stop reason, routing decision, per-case retrieval/answer/product
  latency, and cluster identity. Product latency excludes the independent judge.
- Runtime compaction first persists the complete accepted buffer, then moves
  evicted raw messages into a durable compacted segment, and only then shrinks
  the live buffer. A failed final trim retains the complete persisted buffer for
  retry. Session archives can replay the exact compacted transcript.
- Artifact spillover stores the complete payload under a content-addressed URI
  and retains only a stable URI, hash, byte count, and preview in the spill
  record. Privacy deletion covers payload and projection state.
- Ordinary generalized recall uses bounded projection searches and direct
  canonical gets instead of scope-wide deserialization. Evidence-ledger claim
  lookup is limited to selected memory IDs.

## Verification completed

- `bun run typecheck`: passed.
- At the exact candidate above, the Phase 74 focused sweep passed 445 tests
  across 47 files with 2,379 assertions and zero failures. The canonical suite
  then passed 5,095 tests across 549 files with 27,297 assertions, 13 snapshots,
  and zero failures.
- The current scoring, selection, dataset, product-boundary, aggregation,
  rescore, concurrent version-baseline, and public-claim focused sweep passed
  111 tests across 10 files with 477 assertions and zero failures.
- The current canonical `bun test` sweep passed with exit code zero. The strict
  public-claim gate also reports five consistent declarations and zero
  over-claiming.
- `bun test tests/unit/runtime.context-service.test.ts tests/unit/runtime.public.test.ts tests/integration/recall.api.test.ts`:
  70 passed, 0 failed.
- Claim projection, EvidenceLedger, projection API, generalized fusion,
  RecallPlan, provider planner, reranker, oracle matrix, eval isolation, and
  promotion-gate focused suites passed.
- `bun run gate:phase-74-storage-scale`: 50,000 real ClaimProjection records,
  50,000 real EntityAdjacencyProjection records, and 50,000 status records in
  SQLite. Five warmups plus 40 measured searches produced p95 0.818 ms and
  maximum 0.922 ms, with at most 12 materialized documents per query. The audit
  recorded 90 indexed `searchText` calls, 540 bounded direct `get` calls, and
  zero `query` or `queryPage` calls; both searchable collections used the FTS
  virtual-table index, and invalid-JSON sentinels were never deserialized. The
  500 ms gate passed. A native PostgreSQL integration populated 150,000
  mixed-language projection rows, verified indexed server-side search, bounded
  materialization, and zero `query` / `queryPage` calls, and passed.
- `bun run eval:phase-74-generalization -- --benchmark longmemeval --mode smoke
  --output-dir /private/tmp/GoodMemory-Phase74/smoke-runs --run-id
  phase74-smoke-20260718-final`: 3 cases, 24 E1-E3 retrieval-and-answer
  executions, 12 E4 format rows, 18 oracle rows, zero execution failures, and a
  maximum conservative rendered-context count of 1,023. All 24 retrieval arms
  carry an end-to-end score. E4 correctly returns `selectedFormat =
  not_evaluable` without protection deltas, and the run declares zero live
  model requests.
- Frozen external preparation was verified without model calls. LongMemEval-S
  produced 500 cases and 500 groups from source SHA-256
  `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`
  with normalized fingerprint
  `195fa256c468ff68079f5a05de2572deb47fa2c06b5d48e1d3ad4f3e044a5203`.
  LoCoMo produced 1,986 questions and 10 conversation groups from source
  SHA-256
  `79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4`
  with normalized fingerprint
  `87abd829cbb3bd5110f80ae1df6c42338ca338b131fac48919ed171d46cb7692`
  and prepared-data SHA-256
  `edf70af6cb0fdf2eed50e2f7e69730b9ddadfadce2bee3bebdb141796208317d`.
  Its adapted-case SHA-256 is
  `3ad2284e7c68dc8f678ca785a442adfec26c47f0818e7c86a355500044d4fb28`.
  The manifest explicitly identifies two upstream-missing gold evidence IDs:
  `locomo-conv-42/conv-42:q58` / `D10:19` and
  `locomo-conv-47/conv-47:q38` / `D4:36`; `D30:05` is normalized to the real
  `D30:5` turn rather than reported missing.
  Both complete prepared roots were reloaded through the same fail-closed full
  runner adapter: 500/500 LongMemEval cases/groups and 1,986/10 LoCoMo
  questions/conversations.

## Promotion boundary

`src/eval/phase74PairedInference.ts` computes seeded paired-bootstrap 95%
confidence intervals and exact two-sided McNemar diagnostics with strict case
alignment and rejects duplicate case IDs. Three-run aggregation resamples both
the independent replicate and the paired case/conversation cluster; it records
each case's three replicate deltas and does not average away run-level
variance. McNemar is reported separately per replicate rather than treating
three observations of the same case as independent. A negative replicate
blocks promotion even when the aggregate mean is positive.
`src/eval/phase74PromotionGate.ts`
encodes the release thresholds, including three independent runs, two distinct
improving benchmark families, confidence evidence, protection sets, token and
latency ceilings, zero failures, and no safety regression. It rejects
protocol-reader, gold-aware, and seen-case-only evidence for product promotion.
McNemar remains a binary paired diagnostic; it cannot masquerade as the
required 95% confidence interval, so promotion CI evidence must use paired
bootstrap. The gate also fails closed when provider usage is missing, partial,
internally inconsistent, covers a different case digest, omits per-case answer
generation, mixes the judge into product cost, or uses a different cost
boundary; call counts or manually entered averages are not accepted.
`scripts/aggregate-phase-74-generalization.ts` then validates the complete two
family by three replicate artifact matrix, recomputes all identity/population
digests, and admits only the canonical dataset manifest, protocol scorer,
provider pointwise reranker, and content-hash selection contract. Legacy
identities, deterministic rerankers, and non-canonical scorers fail admission.
A selected subset carries a subset-consistent manifest and can be aggregated
as diagnostic evidence, but it cannot pass product promotion. The aggregator
derives per-case deltas, p95 latency, usage, and the hierarchical statistics,
and invokes the promotion gate only when the evidence is complete.
For E4 it excludes any format that regresses a frozen protection set by more
than 1pp, compares cross-family macro scores, and uses average context tokens as
the tie-break within 1pp of the best eligible score.

## Evaluation runner and remaining live evidence

`src/eval/phase74Generalization.ts` now binds E1-E4, the six-level oracle
matrix, one label-free generic reader for the first five oracle arms, immutable
run identity, exact final-context measurement through an injected counter, and
per-case failure retention. E1-E3 run the same generic reader and independent
judge for every arm after retrieval; product inputs never receive family,
raw benchmark case/session/evidence/source IDs, expected answer, gold evidence,
or protocol metadata. Full-run selection hashes only the opaque semantic case
key; suffixes such as LongMemEval `_abs` stay outside admission. The report keeps semantic
correctness separate from the frozen family score. E4 reuses the frozen
deterministic E3 retrieval snapshot, so formatting does not rerun retrieval.
The executable smoke path is:

```sh
bun run eval:phase-74-generalization -- --benchmark longmemeval --mode smoke
```

The full external roots are prepared separately so source verification happens
before any provider can be constructed:

```sh
bun run prepare:phase-74-datasets -- --benchmark longmemeval \
  --output-root /private/tmp/GoodMemory-Phase74/longmemeval
bun run prepare:phase-74-datasets -- --benchmark locomo \
  --output-root /private/tmp/GoodMemory-Phase74/locomo
```

Before a full stage, compute the exact source identity after freezing the tree,
then export the pinned model configuration. The full runner independently
recomputes and verifies both source values:

```sh
export GOODMEMORY_PHASE74_SOURCE_COMMIT="$(git rev-parse HEAD)"
export GOODMEMORY_PHASE74_SOURCE_SHA256="$(bun -e \
  'import { hashPhase74EvaluatorSourceSnapshot } from "./src/eval/phase74Live"; console.log(await hashPhase74EvaluatorSourceSnapshot(process.cwd()))')"

export GOODMEMORY_EVAL_PROVIDER=openai
export GOODMEMORY_EVAL_BASE_URL=https://ai.gurkiai.com/v1
export GOODMEMORY_EVAL_MODEL=gpt-5.6-terra
export GOODMEMORY_EVAL_API_KEY=...
export GOODMEMORY_JUDGE_PROVIDER=openai
export GOODMEMORY_JUDGE_BASE_URL=https://ai.gurkiai.com/v1
export GOODMEMORY_JUDGE_MODEL=gpt-5.5
export GOODMEMORY_JUDGE_API_KEY=...
export GOODMEMORY_EMBEDDING_PROVIDER=openai
export GOODMEMORY_EMBEDDING_BASE_URL=https://ai.gurkiai.com/v1
export GOODMEMORY_EMBEDDING_MODEL=...
export GOODMEMORY_EMBEDDING_API_KEY=...
```

Each family/replicate must run E1, E2, E3, then E4 with the same immutable run
identity and checkpoint root. E4 fails closed unless the deterministic E3
checkpoint exists:

```sh
for STAGE in E1 E2 E3 E4; do
  bun run eval:phase-74-generalization -- --benchmark longmemeval --mode full \
    --stage "$STAGE" --replicate 1 \
    --benchmark-root /private/tmp/GoodMemory-Phase74/longmemeval \
    --output-dir /private/tmp/GoodMemory-Phase74/runs \
    --run-id phase74-longmemeval-r1
done
```

After both families and all three replicates are frozen, aggregate the six run
directories outside them. A separately frozen protection artifact is required
for E4 selection and product promotion:

```sh
bun run aggregate:phase-74-generalization -- \
  --run-dir /private/tmp/GoodMemory-Phase74/runs/phase74-longmemeval-r1 \
  --run-dir /private/tmp/GoodMemory-Phase74/runs/phase74-longmemeval-r2 \
  --run-dir /private/tmp/GoodMemory-Phase74/runs/phase74-longmemeval-r3 \
  --run-dir /private/tmp/GoodMemory-Phase74/runs/phase74-locomo-r1 \
  --run-dir /private/tmp/GoodMemory-Phase74/runs/phase74-locomo-r2 \
  --run-dir /private/tmp/GoodMemory-Phase74/runs/phase74-locomo-r3 \
  --protection-artifact /path/to/frozen-protection.json \
  --promotion-stage E3 \
  --output /private/tmp/GoodMemory-Phase74/phase74-aggregate.json
```

Each stage writes its dataset manifest, progress, retrieval packets, append-only
usage ledger, usage summary, report, and summary. E4 additionally writes the
six-arm oracle matrix and the explicit non-promotion boundary. It does not
pretend that one stage wrote snapshot, inference, or protection artifacts that
only later stages or a separate aggregation step can produce. The smoke command
passes an empty environment to GoodMemory and therefore cannot accidentally
turn local `.env` provider credentials into live calls.

Smoke remains a deterministic wiring diagnostic with zero live model requests
and is always `not_evaluable`. The complete external roots have been prepared
outside the repository: LongMemEval-S contains 500 cases in 500 memory groups,
and LoCoMo contains 1,986 questions in 10 conversation groups. No paid
promotion run has been produced from those roots.

An exact-source LoCoMo diagnostic was completed on 2026-07-23 from a clean
detached clone of `da82e844`, using seed 621 and two label-free selected cases.
The sealed process manifest records the required order
`seal -> executor_exit -> artifact_verified -> labels_committed ->
scorer_start -> scorer_exit`; all artifact and receipt digests verified. It
produced six E3 executions with zero execution failures and a maximum rendered
context of 1,755 tokens. Mean storage coverage was 0.9 in every arm, but
retrieved gold-evidence recall and end-to-end score were both zero for
`recall-plan-off`, `recall-plan-deterministic`, and `recall-plan-assisted`.
The three arms returned the same selected evidence, context, and final answers;
planning did not alter effective retrieval membership on this two-case sample.
The usage ledger reconciled 26 language calls and 23 embedding calls with no
pending requests. This is useful negative diagnostic evidence, not an estimate
of full-family quality.

A cumulative comparison against the exact pre-Phase-74 `v0.6.0` source was
attempted twice with the same two cases. Both attempts failed closed during the
release arm's preparation: four assisted-extraction calls failed, one embedding
call succeeded, all intents had terminal events, no request remained pending,
and the candidate and scorer never started. Therefore no v0.6-versus-current
score delta exists; release-arm failure is not counted as a candidate win.

The full adapter persists committed retrieval, E4, and oracle units plus
attributed usage artifacts. Its extraction and embedding snapshots are
replayable across the intended arms, and a fake-provider integration exercises
the real SQLite write, extraction, embedding, recall, and rerank chain. Usage is
fsynced before checkpoint commit and survives ordinary resume; failures to
commit a terminal event fail closed. Durable request intents now reconcile with
terminal events, and the live diagnostic above finished with no pending
requests. A genuinely sealed external cohort is still required; both public
benchmark families are known data, so `seenCasesOnly` remains true. No complete
E4 protection delta has been supplied, so format selection remains
`not_evaluable`.

The following evidence is still required before changing the default pipeline
or making a generalized-memory uplift claim:

1. Validate the frozen LoCoMo family-score adapter against the upstream
   category-specific scorer, then run E1, E2, E3, and E4 with frozen datasets,
   reader, prompt, model, budget,
   temperature, gateway, concurrency, and independent judge.
2. Complete at least three independent runs on LongMemEval and LoCoMo, plus the
   specified held-out and protection suites.
3. Feed the six frozen run directories and an independently frozen protection
   artifact to the aggregation CLI; inspect hierarchical confidence intervals,
   per-replicate McNemar diagnostics, per-case deltas, and E4 selection.
4. Confirm full-product model-token cost, end-to-end p95 latency,
   hallucination, update, abstention, and privacy thresholds.

Until those steps pass, the new pipeline remains experimental, the existing
retrieval path remains the rollback path, and no benchmark score improvement is
claimed by this implementation record.
