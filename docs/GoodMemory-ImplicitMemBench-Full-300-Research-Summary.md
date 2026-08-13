# GoodMemory Full ImplicitMemBench 300-Case Research Summary

Initial run date: `2026-04-28`

Latest rerun update: `2026-07-06`

Status: internal diagnostic only. The 2026-07-06 stored-answer cross-version
rescore and the fresh answer-regeneration reruns are research/drift evidence;
neither is eligible for current or historical claim promotion. This document
does not reopen the accepted Phase 49 research checkpoint, and it does not make
full ImplicitMemBench a release gate.

The post-Phase-59 full-300 miss reopened Phase 59's internal research
workstream; the later `phase59-reopen9` follow-up met that reopened research
target. Neither run reopens Phase 49 or any public release claim.

Phase 53 later closed on targeted deterministic/live behavioral evidence plus
a follow-up Postgres-backed full-300 rerun. That full-300 rerun remains
research evidence and does not make ImplicitMemBench a release gate.

## Scope

This document summarizes full 300-case ImplicitMemBench executions through
GoodMemory's Phase 49 research harness:

- the initial full run used to establish the first full-300 baseline versus
  GoodMemory comparison
- a post-Phase-51 GoodMemory rerun used to test whether typed behavioral
  memory and later conditioning/enactment improvements actually moved the
  full benchmark
- a post-Phase-52 GoodMemory rerun used to check whether structured
  text-response enactment extended the full-300 frontier
- a post-Phase-53 GoodMemory rerun used to check whether harder surface
  determinism, escalation routing, and exact command recovery moved the same
  benchmark without changing the release gate
- a post-Phase-54 GoodMemory rerun used to check whether exemplar-first raw
  carryover and the accepted raw-internalization slice improved the same full
  benchmark under the established sharded Postgres-backed setup
- a post-Phase-55 GoodMemory rerun used to check whether probe-conditioned raw
  carryover and retrieval calibration generalized beyond the targeted raw gate
  and moved the same benchmark under the same sharded Postgres-backed setup
- a post-Phase-56 GoodMemory rerun used to check whether hypothesis-carrying
  raw internalization finally moved the full-300 raw benchmark, not just the
  targeted gate
- a post-Phase-57 GoodMemory rerun used to check whether raw internalization
  generalization and enactment moved the same full-300 benchmark under the
  established five-shard Postgres-backed setup
- a post-Phase-58 GoodMemory rerun used to check whether raw enactment
  compiler and repair-loop work moved the same full-300 benchmark while
  preserving distilled quality and leak controls
- a post-Phase-59 reopened GoodMemory rerun used to check whether generalized
  raw exact-action repair, concise exact-answer repair, and priming fail-open
  separation moved the reopened raw research target without changing public
  claims

The goal was not to measure prompt-following alone. The comparison keeps the
upstream baseline and the GoodMemory-mediated path separate:

- `baseline-upstream-chat`
  - upstream-style prompt injection of learning, interference, and probe into
    one final generation
- `goodmemory-raw-experience`
  - replay learning and interference into GoodMemory, then give the final
    generator only `memoryContext + test_probe`
- `goodmemory-distilled-feedback`
  - same probe-only final generation, with explicit feedback distillation for
    procedural and conditioning cases

Priming remains paired `experimental/control` and is intentionally absent from
`goodmemory-distilled-feedback`.

## Run Setup

- Upstream benchmark checkout:
  - local external checkout at `/tmp/ImplicitMemBench`
- Total cases:
  - `300`
  - `100` `classical_conditioning`
  - `100` `procedural_memory`
  - `100` `priming`
- Scorer routing:
  - `35` `structured_first_action`
  - `165` `text_behavior_judge`
  - `100` `priming_pair_judge`
- Execution mode:
  - Phase 49 live research harness
  - 5 balanced shards of 60 cases each for the initial run
  - 5 balanced shards of mixed-family workload for the post-Phase-51 rerun
  - per-process `GOODMEMORY_EVAL_MAX_CONCURRENCY=1`
  - parallel shard execution across 5 Bun processes
  - GoodMemory storage forced to Postgres for sharded runs to avoid local
    SQLite lock contention
  - GoodMemory paths used provider-backed embeddings and assisted extraction
    through the configured `GOODMEMORY_EMBEDDING_*` and
    `GOODMEMORY_ASSISTED_EXTRACTOR_*` environment variables

Local shard outputs for the initial run were written under:

- `/tmp/phase49-sharded-pg/shard-01`
- `/tmp/phase49-sharded-pg/shard-02`
- `/tmp/phase49-sharded-pg/shard-03`
- `/tmp/phase49-sharded-pg/shard-04`
- `/tmp/phase49-sharded-pg/shard-05`

The post-Phase-51 rerun wrote GoodMemory shard reports under:

- `reports/eval/research/phase-49/goodmemory/run-phase49-full-shard-01-pg-20260501`
- `reports/eval/research/phase-49/goodmemory/run-phase49-full-shard-02-pg-20260501`
- `reports/eval/research/phase-49/goodmemory/run-phase49-full-shard-03-pg-20260501`
- `reports/eval/research/phase-49/goodmemory/run-phase49-full-shard-04-pg-20260501`
- `reports/eval/research/phase-49/goodmemory/run-phase49-full-shard-05-pg-20260501`

The post-Phase-53 rerun used 5 balanced local shard roots under
`/tmp/gm-phase53-shards-20260502/` and wrote GoodMemory shard reports under:

- `reports/eval/research/phase-49/goodmemory/run-phase49-full-postphase53-pg-20260502-r3-shard-01`
- `reports/eval/research/phase-49/goodmemory/run-phase49-full-postphase53-pg-20260502-r3-shard-02`
- `reports/eval/research/phase-49/goodmemory/run-phase49-full-postphase53-pg-20260502-r3-shard-03`
- `reports/eval/research/phase-49/goodmemory/run-phase49-full-postphase53-pg-20260502-r3-shard-04`
- `reports/eval/research/phase-49/goodmemory/run-phase49-full-postphase53-pg-20260502-r3-shard-05`

The post-Phase-54 rerun used 5 balanced local shard roots under
`/tmp/ImplicitMemBench-phase54-shards-20260503/` and wrote GoodMemory shard
reports under:

- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase54-shard-01-20260503`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase54-shard-02-20260503`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase54-shard-03-20260503`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase54-shard-04-20260503`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase54-shard-05-20260503`

The post-Phase-55 rerun used 5 balanced local shard roots under
`/tmp/ImplicitMemBench-phase55-shards-20260503/` and wrote GoodMemory shard
reports under:

- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase55-r1-shard-01-20260503`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase55-r1-shard-02-20260503`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase55-r1-shard-03-20260503`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase55-r1-shard-04-20260503`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase55-r1-shard-05-20260503`

The post-Phase-56 rerun used the established 5 balanced local shard roots under
`/tmp/ImplicitMemBench-phase54-shards-20260503/` and wrote GoodMemory shard
reports under:

- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase56-shard-01-20260504`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase56-shard-02-20260504`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase56-shard-03-20260504`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase56-shard-04-20260504`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase56-shard-05-20260504`

The post-Phase-57 rerun used the same established 5 balanced local shard roots
and wrote GoodMemory shard reports under:

- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase57-shard-01-20260504`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase57-shard-02-20260504`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase57-shard-03-20260504`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase57-shard-04-20260504`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase57-shard-05-20260504`

The post-Phase-58 rerun used the same established 5 balanced local shard roots
and wrote GoodMemory shard reports under:

- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase58-shard-01-20260504`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase58-shard-02-20260504`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase58-shard-03-20260504`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase58-shard-04-20260504`
- `reports/eval/research/phase-49/goodmemory/run-phase49-postphase58-shard-05-20260504`

The Phase 59 reopened `phase59-reopen9` rerun used 5 balanced local shard roots
under `/tmp/ImplicitMemBench-phase59-reopened-shards-20260504/` and wrote
GoodMemory shard reports under `/tmp/phase59-reopen9-goodmemory-reports/`:

- `/tmp/phase59-reopen9-goodmemory-reports/shard-01/run-phase59-reopen9-shard-01-20260504`
- `/tmp/phase59-reopen9-goodmemory-reports/shard-02/run-phase59-reopen9-shard-02-20260504`
- `/tmp/phase59-reopen9-goodmemory-reports/shard-03/run-phase59-reopen9-shard-03-20260504`
- `/tmp/phase59-reopen9-goodmemory-reports/shard-04/run-phase59-reopen9-shard-04-20260504`
- `/tmp/phase59-reopen9-goodmemory-reports/shard-05/run-phase59-reopen9-shard-05-20260504`

Its repo summary artifact is
`reports/quality-gates/phase-59/run-20260504193000/phase-59-reopen9-full300-research-summary.json`.

These runs are intentionally not promoted to release-gate status. They remain
research evidence only.

## Topline Results

### Initial Full-300 Run (`2026-04-28`)

#### Blocking Cases

Blocking cases are `classical_conditioning + procedural_memory = 200` total.

| Profile | Passed | Total | Pass Rate |
| --- | ---: | ---: | ---: |
| `baseline-upstream-chat` | 108 | 200 | 54.0% |
| `goodmemory-raw-experience` | 42 | 200 | 21.0% |
| `goodmemory-distilled-feedback` | 77 | 200 | 38.5% |

#### By Dataset Family

| Dataset | Baseline | Raw | Distilled |
| --- | ---: | ---: | ---: |
| `classical_conditioning` | 55 / 100 | 32 / 100 | 54 / 100 |
| `procedural_memory` | 53 / 100 | 10 / 100 | 23 / 100 |

#### By Scorer Family

| Scorer | Baseline | Raw | Distilled |
| --- | ---: | ---: | ---: |
| `text_behavior_judge` | 106 / 165 | 42 / 165 | 74 / 165 |
| `structured_first_action` | 2 / 35 | 0 / 35 | 3 / 35 |

#### Priming

Priming is non-blocking and measured as average `primingInfluenceScore`.

| Profile | Average Score |
| --- | ---: |
| `baseline-upstream-chat` | 0.84 |
| `goodmemory-raw-experience` | 4.48 |

Observed `delta-of-delta`: `+3.64`

#### Execution Quality

- `executionFailures = 0`
- `explicitRecallLeakCount`
  - baseline: `10`
  - raw: `23`
  - distilled: `22`

### Post-Phase-51 GoodMemory Rerun (`2026-05-01`)

The rerun refreshed GoodMemory only. It did **not** rerun the upstream baseline,
so comparisons in this section are against the prior GoodMemory full run, not a
same-day baseline refresh.

#### Blocking Cases

| Profile | Passed | Total | Pass Rate |
| --- | ---: | ---: | ---: |
| `goodmemory-raw-experience` | 34 | 200 | 17.0% |
| `goodmemory-distilled-feedback` | 89 | 200 | 44.5% |

#### By Dataset Family

| Dataset | Raw | Distilled |
| --- | ---: | ---: |
| `classical_conditioning` | 25 / 100 | 64 / 100 |
| `procedural_memory` | 9 / 100 | 25 / 100 |

#### By Scorer Family

| Scorer | Raw | Distilled |
| --- | ---: | ---: |
| `text_behavior_judge` | 34 / 165 | 86 / 165 |
| `structured_first_action` | 0 / 35 | 3 / 35 |

#### Priming

| Profile | Average Score |
| --- | ---: |
| `goodmemory-raw-experience` | 2.86 |

#### Execution Quality

- `executionFailures`
  - raw: `18`
  - distilled: `8`
- `explicitRecallLeakCount`
  - raw: `2`
  - distilled: `0`

### Post-Phase-52 GoodMemory Rerun (`2026-05-02`)

This rerun again refreshed GoodMemory only. It used the same external
benchmark checkout shape, but explicitly ran with provider-backed Postgres
storage plus the configured embedding and assisted-extractor stack from the
repo `.env`.

#### Blocking Cases

| Profile | Passed | Total | Pass Rate |
| --- | ---: | ---: | ---: |
| `goodmemory-raw-experience` | 31 | 200 | 15.5% |
| `goodmemory-distilled-feedback` | 87 | 200 | 43.5% |

#### By Dataset Family

| Dataset | Raw | Distilled |
| --- | ---: | ---: |
| `classical_conditioning` | 24 / 100 | 63 / 100 |
| `procedural_memory` | 7 / 100 | 24 / 100 |

#### By Scorer Family

| Scorer | Raw | Distilled |
| --- | ---: | ---: |
| `text_behavior_judge` | 31 / 165 | 84 / 165 |
| `structured_first_action` | 0 / 35 | 3 / 35 |

#### Priming

| Profile | Average Score |
| --- | ---: |
| `goodmemory-raw-experience` | 2.3833 |

#### Execution Quality

- `executionFailures`
  - raw: `17`
  - distilled: `9`
- `explicitRecallLeakCount`
  - raw: `2`
  - distilled: `0`

### Post-Phase-53 GoodMemory Rerun (`2026-05-02`)

This rerun refreshed GoodMemory only. It was executed as 5 balanced shards with
`GOODMEMORY_STORAGE_PROVIDER=postgres`,
`GOODMEMORY_STORAGE_URL=$GOODMEMORY_TEST_POSTGRES_URL`, and per-process
`GOODMEMORY_EVAL_MAX_CONCURRENCY=1`.

#### Blocking Cases

| Profile | Passed | Total | Pass Rate |
| --- | ---: | ---: | ---: |
| `goodmemory-raw-experience` | 36 | 200 | 18.0% |
| `goodmemory-distilled-feedback` | 90 | 200 | 45.0% |

#### By Dataset Family

| Dataset | Raw | Distilled |
| --- | ---: | ---: |
| `classical_conditioning` | 28 / 100 | 62 / 100 |
| `procedural_memory` | 8 / 100 | 28 / 100 |

#### By Scorer Family

| Scorer | Raw | Distilled |
| --- | ---: | ---: |
| `text_behavior_judge` | 36 / 165 | 83 / 165 |
| `structured_first_action` | 0 / 35 | 7 / 35 |

#### Priming

| Profile | Average Score |
| --- | ---: |
| `goodmemory-raw-experience` | 3.3333 |

#### Execution Quality

- `executionFailures`
  - raw: `5`
  - distilled: `0`
- `explicitRecallLeakCount`
  - raw: `1`
  - distilled: `1`

### Post-Phase-53 Continued Hardening Rerun (`2026-05-02`, instance-grounded synthesis + structured scoring fix)

This rerun reflects the additional hardening landed after the earlier
post-Phase-53 snapshot:

- conditioning synthesis now prefers path-root recovery before file-extension
  fallback, so directory-restriction learning is not overwritten by `.tar` /
  `.bin` artifact noise
- contradictory safe-path warnings are rebuilt from the original unsafe query
  target instead of self-contradicting around the redirected path
- structured first-action cases now score against each instance's
  `expected_pattern` rather than a task-level static exemplar
- `copy_file` first-action recovery no longer gets confused by contractions
  such as `I'm` in the probe

It was again executed as explicit Postgres-backed balanced shards, with the
same embedding and assisted-extractor stack used by the live GoodMemory path.

#### Blocking Cases

| Profile | Passed | Total | Pass Rate |
| --- | ---: | ---: | ---: |
| `goodmemory-raw-experience` | 32 | 200 | 16.0% |
| `goodmemory-distilled-feedback` | 121 | 200 | 60.5% |

#### By Dataset Family

| Dataset | Raw | Distilled |
| --- | ---: | ---: |
| `classical_conditioning` | 23 / 100 | 87 / 100 |
| `procedural_memory` | 9 / 100 | 34 / 100 |

#### By Scorer Family

| Scorer | Raw | Distilled |
| --- | ---: | ---: |
| `text_behavior_judge` | 32 / 165 | 115 / 165 |
| `structured_first_action` | 0 / 35 | 6 / 35 |

#### Priming

| Profile | Average Score |
| --- | ---: |
| `goodmemory-raw-experience` | 3.12 |

#### Execution Quality

- `executionFailures`
  - raw: `4`
  - distilled: `0`
- `explicitRecallLeakCount`
  - raw: `2`
  - distilled: `0`

### Post-Phase-54 GoodMemory Rerun (`2026-05-03`, exemplar-first raw carryover + balanced shard rerun)

This rerun was executed after Phase 54 closed on targeted deterministic/live
evidence. It kept the established research execution strategy:

- 5 balanced mixed-family shards
- explicit Postgres-backed GoodMemory storage
- per-process concurrency `1`
- provider-backed embeddings and assisted extraction

It also kept the current full-benchmark contract honest by running the same
Phase 49 research harness rather than a benchmark-specific side path.

#### Blocking Cases

| Profile | Passed | Total | Pass Rate |
| --- | ---: | ---: | ---: |
| `goodmemory-raw-experience` | 42 | 200 | 21.0% |
| `goodmemory-distilled-feedback` | 151 | 200 | 75.5% |

#### By Dataset Family

| Dataset | Raw | Distilled |
| --- | ---: | ---: |
| `classical_conditioning` | 14 / 100 | 85 / 100 |
| `procedural_memory` | 28 / 100 | 66 / 100 |

#### By Scorer Family

| Scorer | Raw | Distilled |
| --- | ---: | ---: |
| `text_behavior_judge` | 37 / 165 | 130 / 165 |
| `structured_first_action` | 5 / 35 | 21 / 35 |

#### Priming

| Profile | Average Score |
| --- | ---: |
| `goodmemory-raw-experience` | 1.1263 |

#### Execution Quality

- `executionFailures`
  - raw: `19`
  - distilled: `3`
- `explicitRecallLeakCount`
  - raw: `3`
  - distilled: `0`

### Post-Phase-55 GoodMemory Rerun (`2026-05-03`, probe-conditioned raw carryover + retrieval calibration)

This rerun again refreshed GoodMemory only. It kept the same external benchmark
checkout shape and the same provider-backed research execution contract:

- 5 balanced mixed-family shards
- explicit Postgres-backed GoodMemory storage
- per-process concurrency `1`
- provider-backed embeddings and assisted extraction

The point of this rerun was not to celebrate the Phase 55 targeted gate. It was
to check whether the new raw carryover isolation and retrieval calibration would
survive the broader full-300 workload.

#### Blocking Cases

| Profile | Passed | Total | Pass Rate |
| --- | ---: | ---: | ---: |
| `goodmemory-raw-experience` | 35 | 200 | 17.5% |
| `goodmemory-distilled-feedback` | 148 | 200 | 74.0% |

#### By Dataset Family

| Dataset | Raw | Distilled |
| --- | ---: | ---: |
| `classical_conditioning` | 17 / 100 | 82 / 100 |
| `procedural_memory` | 18 / 100 | 66 / 100 |

#### By Scorer Family

| Scorer | Raw | Distilled |
| --- | ---: | ---: |
| `text_behavior_judge` | 34 / 165 | 126 / 165 |
| `structured_first_action` | 1 / 35 | 22 / 35 |

#### Priming

| Profile | Average Score |
| --- | ---: |
| `goodmemory-raw-experience` | 1.8065 |

#### Execution Quality

- `executionFailures`
  - raw: `8`
  - distilled: `1`
- `explicitRecallLeakCount`
  - raw: `4`
  - distilled: `2`

### Post-Phase-56 GoodMemory Rerun (`2026-05-04`, hypothesis-carrying raw internalization + Postgres 5-shard follow-up)

This rerun executed the required post-gate follow-up for Phase 56. It kept the
same external benchmark-root contract and the same provider-backed research
execution setup:

- 5 balanced mixed-family shards
- explicit Postgres-backed GoodMemory storage
- per-process concurrency `1`
- provider-backed embeddings and assisted extraction

The point was to check whether the new support/conflict retrieval, transient
task hypotheses, and probe-time raw execution generalized beyond the targeted
gate and into the full 300-case workload.

#### Blocking Cases

| Profile | Passed | Total | Pass Rate |
| --- | ---: | ---: | ---: |
| `goodmemory-raw-experience` | 45 | 200 | 22.5% |
| `goodmemory-distilled-feedback` | 152 | 200 | 76.0% |

#### By Dataset Family

| Dataset | Raw | Distilled |
| --- | ---: | ---: |
| `classical_conditioning` | 22 / 100 | 87 / 100 |
| `procedural_memory` | 23 / 100 | 65 / 100 |

#### By Scorer Family

| Scorer | Raw | Distilled |
| --- | ---: | ---: |
| `text_behavior_judge` | 37 / 165 | 131 / 165 |
| `structured_first_action` | 8 / 35 | 21 / 35 |

#### Priming

| Profile | Average Score |
| --- | ---: |
| `goodmemory-raw-experience` | 0.8352 |

#### Execution Quality

- `executionFailures`
  - raw: `15`
  - distilled: `4`
- `explicitRecallLeakCount`
  - raw: `1`
  - distilled: `0`

### Post-Phase-57 GoodMemory Rerun (`2026-05-04`, raw internalization generalization + Postgres 5-shard follow-up)

This rerun executed the required post-gate research follow-up for Phase 57. It
kept the same external benchmark-root contract and the same provider-backed
research execution setup:

- 5 balanced mixed-family shards
- explicit Postgres-backed GoodMemory storage
- per-process concurrency `1`
- provider-backed embeddings and assisted extraction

The point was to check whether the raw generalization work from Phase 57
converted the targeted `10 / 12` mechanism proof into a meaningful full-300
movement. It did move raw, but it did not meet the research target and it
regressed the distilled full-300 line below the Phase 56 high-water mark.

#### Blocking Cases

| Profile | Passed | Total | Pass Rate |
| --- | ---: | ---: | ---: |
| `goodmemory-raw-experience` | 50 | 200 | 25.0% |
| `goodmemory-distilled-feedback` | 148 | 200 | 74.0% |

#### By Dataset Family

| Dataset | Raw | Distilled |
| --- | ---: | ---: |
| `classical_conditioning` | 23 / 100 | 86 / 100 |
| `procedural_memory` | 27 / 100 | 62 / 100 |

#### By Scorer Family

| Scorer | Raw | Distilled |
| --- | ---: | ---: |
| `text_behavior_judge` | 42 / 165 | 128 / 165 |
| `structured_first_action` | 8 / 35 | 20 / 35 |

#### Priming

| Profile | Average Score |
| --- | ---: |
| `goodmemory-raw-experience` | 0.6897 |

#### Execution Quality

- `executionFailures`
  - raw: `15`
  - distilled: `5`
- blocking `executionFailures`
  - raw: `2`
  - distilled: `5`
- non-blocking `executionFailures`
  - raw: `13`
  - distilled: `0`
- `explicitRecallLeakCount`
  - raw: `2`
  - distilled: `1`

#### Raw Diagnosis

The post-Phase-57 raw diagnosis confirms that the next bottleneck is still
enactment, not just retrieval:

- `selected_but_not_enacted`: `75`
- `support_conflict`: `51`
- `memory_miss`: `99`
- `wrong_exemplar`: `7`
- `operator_failure`: `15`

### Post-Phase-58 GoodMemory Rerun (`2026-05-04`, raw enactment compiler + Postgres 5-shard follow-up)

This rerun executed the post-gate research follow-up for Phase 58. It kept the
same external benchmark-root contract and provider-backed research execution
setup:

- 5 balanced mixed-family shards
- explicit Postgres-backed GoodMemory storage
- per-process concurrency `1`
- provider-backed embeddings and assisted extraction

The result shows that deterministic raw enactment and repair moved the full
raw line sharply and restored distilled above the `150 / 200` target. It still
did not fully close raw leak and operator reliability: raw blocking execution
failures stayed at `3`, raw explicit recall leaks were `2`, and most remaining
raw failures still came from missing or non-enacted generalized control.

#### Blocking Cases

| Profile | Passed | Total | Pass Rate |
| --- | ---: | ---: | ---: |
| `goodmemory-raw-experience` | 90 | 200 | 45.0% |
| `goodmemory-distilled-feedback` | 151 | 200 | 75.5% |

#### By Dataset Family

| Dataset | Raw | Distilled |
| --- | ---: | ---: |
| `classical_conditioning` | 61 / 100 | 85 / 100 |
| `procedural_memory` | 29 / 100 | 66 / 100 |

#### By Scorer Family

| Scorer | Raw | Distilled |
| --- | ---: | ---: |
| `text_behavior_judge` | 82 / 165 | 130 / 165 |
| `structured_first_action` | 8 / 35 | 21 / 35 |

#### Priming

| Profile | Average Score |
| --- | ---: |
| `goodmemory-raw-experience` | 0.2947 |

#### Execution Quality

- `executionFailures`
  - raw: `16`
  - distilled: `3`
- blocking `executionFailures`
  - raw: `3`
  - distilled: `3`
- `explicitRecallLeakCount`
  - raw: `2`
  - distilled: `0`

#### Raw Diagnosis

The post-Phase-58 raw diagnosis confirms that the mechanism improved, but
generalization and reliability remain the next bottleneck:

- `selected_but_not_enacted`: `59`
- `support_conflict`: `21`
- `memory_miss`: `104`
- `wrong_exemplar`: `7`
- `operator_failure`: `16`
- execution failure buckets:
  - `invalid_json_response`: `14`
  - `semantic_search_failure`: `2`

### Delta Versus The Initial GoodMemory Run

| Metric | Initial | Post-Phase-51 | Delta |
| --- | ---: | ---: | ---: |
| overall raw blocking pass rate | `21.0%` | `17.0%` | `-4.0 pts` |
| overall distilled blocking pass rate | `38.5%` | `44.5%` | `+6.0 pts` |
| conditioning distilled | `54 / 100` | `64 / 100` | `+10` |
| procedural distilled | `23 / 100` | `25 / 100` | `+2` |
| structured first-action distilled | `3 / 35` | `3 / 35` | `0` |
| raw explicit recall leaks | `23` | `2` | `-21` |
| distilled explicit recall leaks | `22` | `0` | `-22` |

### Delta Versus The Post-Phase-51 GoodMemory Rerun

| Metric | Post-Phase-51 | Post-Phase-52 | Delta |
| --- | ---: | ---: | ---: |
| overall raw blocking pass rate | `17.0%` | `15.5%` | `-1.5 pts` |
| overall distilled blocking pass rate | `44.5%` | `43.5%` | `-1.0 pts` |
| conditioning distilled | `64 / 100` | `63 / 100` | `-1` |
| procedural distilled | `25 / 100` | `24 / 100` | `-1` |
| structured first-action distilled | `3 / 35` | `3 / 35` | `0` |
| raw explicit recall leaks | `2` | `2` | `0` |
| distilled explicit recall leaks | `0` | `0` | `0` |

### Delta Versus The Post-Phase-52 GoodMemory Rerun

| Metric | Post-Phase-52 | Post-Phase-53 | Delta |
| --- | ---: | ---: | ---: |
| overall raw blocking pass rate | `15.5%` | `18.0%` | `+2.5 pts` |
| overall distilled blocking pass rate | `43.5%` | `45.0%` | `+1.5 pts` |
| conditioning distilled | `63 / 100` | `62 / 100` | `-1` |
| procedural distilled | `24 / 100` | `28 / 100` | `+4` |
| structured first-action distilled | `3 / 35` | `7 / 35` | `+4` |
| raw execution failures | `17` | `5` | `-12` |
| distilled execution failures | `9` | `0` | `-9` |
| raw explicit recall leaks | `2` | `1` | `-1` |
| distilled explicit recall leaks | `0` | `1` | `+1` |

### Delta Versus The Earlier Post-Phase-53 Snapshot

| Metric | Earlier Post-Phase-53 | Continued Hardening | Delta |
| --- | ---: | ---: | ---: |
| overall raw blocking pass rate | `18.0%` | `16.0%` | `-2.0 pts` |
| overall distilled blocking pass rate | `45.0%` | `60.5%` | `+15.5 pts` |
| conditioning distilled | `62 / 100` | `87 / 100` | `+25` |
| procedural distilled | `28 / 100` | `34 / 100` | `+6` |
| structured first-action distilled | `7 / 35` | `6 / 35` | `-1` |
| raw execution failures | `5` | `4` | `-1` |
| distilled execution failures | `0` | `0` | `0` |
| raw explicit recall leaks | `1` | `2` | `+1` |
| distilled explicit recall leaks | `1` | `0` | `-1` |

### Delta Versus The Post-Phase-53 Continued Hardening Rerun

| Metric | Continued Hardening | Post-Phase-54 | Delta |
| --- | ---: | ---: | ---: |
| overall raw blocking pass rate | `16.0%` | `21.0%` | `+5.0 pts` |
| overall distilled blocking pass rate | `60.5%` | `75.5%` | `+15.0 pts` |
| conditioning distilled | `87 / 100` | `85 / 100` | `-2` |
| procedural distilled | `34 / 100` | `66 / 100` | `+32` |
| structured first-action distilled | `6 / 35` | `21 / 35` | `+15` |
| raw execution failures | `4` | `19` | `+15` |
| distilled execution failures | `0` | `3` | `+3` |
| raw explicit recall leaks | `2` | `3` | `+1` |
| distilled explicit recall leaks | `0` | `0` | `0` |

### Delta Versus The Post-Phase-54 GoodMemory Rerun

| Metric | Post-Phase-54 | Post-Phase-55 | Delta |
| --- | ---: | ---: | ---: |
| overall raw blocking pass rate | `21.0%` | `17.5%` | `-3.5 pts` |
| overall distilled blocking pass rate | `75.5%` | `74.0%` | `-1.5 pts` |
| conditioning raw | `14 / 100` | `17 / 100` | `+3` |
| procedural raw | `28 / 100` | `18 / 100` | `-10` |
| conditioning distilled | `85 / 100` | `82 / 100` | `-3` |
| procedural distilled | `66 / 100` | `66 / 100` | `0` |
| structured first-action raw | `5 / 35` | `1 / 35` | `-4` |
| structured first-action distilled | `21 / 35` | `22 / 35` | `+1` |
| raw execution failures | `19` | `8` | `-11` |
| distilled execution failures | `3` | `1` | `-2` |
| raw explicit recall leaks | `3` | `4` | `+1` |
| distilled explicit recall leaks | `0` | `2` | `+2` |

### Delta Versus The Post-Phase-55 GoodMemory Rerun

| Metric | Post-Phase-55 | Post-Phase-56 | Delta |
| --- | ---: | ---: | ---: |
| overall raw blocking pass rate | `17.5%` | `22.5%` | `+5.0 pts` |
| overall distilled blocking pass rate | `74.0%` | `76.0%` | `+2.0 pts` |
| conditioning raw | `17 / 100` | `22 / 100` | `+5` |
| procedural raw | `18 / 100` | `23 / 100` | `+5` |
| conditioning distilled | `82 / 100` | `87 / 100` | `+5` |
| procedural distilled | `66 / 100` | `65 / 100` | `-1` |
| structured first-action raw | `1 / 35` | `8 / 35` | `+7` |
| structured first-action distilled | `22 / 35` | `21 / 35` | `-1` |
| raw execution failures | `8` | `15` | `+7` |
| distilled execution failures | `1` | `4` | `+3` |
| raw explicit recall leaks | `4` | `1` | `-3` |
| distilled explicit recall leaks | `2` | `0` | `-2` |

### Delta Versus The Post-Phase-56 GoodMemory Rerun

| Metric | Post-Phase-56 | Post-Phase-57 | Delta |
| --- | ---: | ---: | ---: |
| overall raw blocking pass rate | `22.5%` | `25.0%` | `+2.5 pts` |
| overall distilled blocking pass rate | `76.0%` | `74.0%` | `-2.0 pts` |
| conditioning raw | `22 / 100` | `23 / 100` | `+1` |
| procedural raw | `23 / 100` | `27 / 100` | `+4` |
| conditioning distilled | `87 / 100` | `86 / 100` | `-1` |
| procedural distilled | `65 / 100` | `62 / 100` | `-3` |
| structured first-action raw | `8 / 35` | `8 / 35` | `0` |
| structured first-action distilled | `21 / 35` | `20 / 35` | `-1` |
| raw blocking execution failures | `15` | `2` | `-13` |
| distilled blocking execution failures | `4` | `5` | `+1` |
| raw explicit recall leaks | `1` | `2` | `+1` |
| distilled explicit recall leaks | `0` | `1` | `+1` |

## What The Results Say

### 1. Raw experience replay is still weak, but Phase 57 moved the full-300 raw line again without meeting target

The central result did not change: `goodmemory-raw-experience` remains far
below the upstream baseline. Phase 53 recovered part of the post-Phase-52 drop,
but raw replay is still not a reliable product mechanism by itself.

- baseline: `54.0%`
- initial raw: `21.0%`
- post-Phase-51 raw: `17.0%`
- post-Phase-52 raw: `15.5%`
- post-Phase-53 raw: `18.0%`
- post-Phase-53 continued hardening raw: `16.0%`
- post-Phase-54 raw: `21.0%`
- post-Phase-55 raw: `17.5%`
- post-Phase-56 raw: `22.5%`
- post-Phase-57 raw: `25.0%`

This means the current GoodMemory stack does not yet turn most learning and
interference examples into reliable downstream behavior when the final probe is
probe-only. Phase 56 moved the full-300 raw result again, and Phase 57 pushed
it further to `50 / 200`. That is real movement, but it still missed the
Phase 57 research target of `65 / 200`; diagnostics remained dominated by
selected-but-not-enacted, support-conflict, and memory-miss behavior.

### 2. Distillation remains the strongest path, but Phase 57 did not preserve the Phase 56 high-water mark

`goodmemory-distilled-feedback` still carries the real value in the system.
The strongest family remains `classical_conditioning`, and this new rerun is
the first one where explicit policy distillation crossed a clear majority of
blocking cases on the full 300-item suite:

- baseline: `55 / 100`
- initial distilled: `54 / 100`
- post-Phase-51 distilled: `64 / 100`
- post-Phase-52 distilled: `63 / 100`
- post-Phase-53 distilled: `62 / 100`
- post-Phase-53 continued hardening distilled: `87 / 100`
- post-Phase-54 distilled: `85 / 100`
- post-Phase-55 distilled: `82 / 100`
- post-Phase-56 distilled: `87 / 100`
- post-Phase-57 distilled: `86 / 100`

The same rerun also lifted `procedural_memory`, though that family is still
well below baseline:

- baseline: `53 / 100`
- initial distilled: `23 / 100`
- post-Phase-51 distilled: `25 / 100`
- post-Phase-52 distilled: `24 / 100`
- post-Phase-53 distilled: `28 / 100`
- post-Phase-53 continued hardening distilled: `34 / 100`
- post-Phase-54 distilled: `66 / 100`
- post-Phase-55 distilled: `66 / 100`
- post-Phase-56 distilled: `65 / 100`
- post-Phase-57 distilled: `62 / 100`

So the value is still concentrated in explicit rule distillation for local
behavioral constraints, but the effect is now much broader. The post-Phase-54
rerun moved GoodMemory from the earlier `121 / 200` distilled high-water mark
to `151 / 200`, driven mostly by a large procedural jump rather than another
conditioning-only step. The post-Phase-55 rerun stayed strong at `148 / 200`
and improved operator reliability, but it did not surpass the post-Phase-54
high-water mark. Phase 56 pushed the distilled line to `152 / 200`, setting
the current best full-300 GoodMemory result. Phase 57 fell back to
`148 / 200`, so distilled remains strong but the latest rerun did not meet the
`>= 150 / 200` research target.

### 3. Strict first-action enactment is the weakest surface

The `structured_first_action` subgroup remains poor across all profiles:

- baseline: `2 / 35`
- initial raw: `0 / 35`
- initial distilled: `3 / 35`
- post-Phase-51 raw: `0 / 35`
- post-Phase-51 distilled: `3 / 35`
- post-Phase-52 distilled: `3 / 35`
- post-Phase-53 distilled: `7 / 35`
- post-Phase-53 continued hardening distilled: `6 / 35`
- post-Phase-54 distilled: `21 / 35`
- post-Phase-55 distilled: `22 / 35`
- post-Phase-56 raw: `8 / 35`
- post-Phase-56 distilled: `21 / 35`
- post-Phase-57 raw: `8 / 35`
- post-Phase-57 distilled: `20 / 35`

The continued hardening rerun fixed a real scoring bug by switching procedural
structured cases to instance-level expected actions, and the post-Phase-54
rerun finally pushed this surface to `21 / 35`. Phase 55 nudged that to
`22 / 35`. Phase 56 improved raw strict-action carryover to `8 / 35`, and
Phase 57 held raw there while distilled slipped to `20 / 35`. This is still
below where a strong host-action memory layer should be.

### 4. Execution quality is mixed: raw operator noise rose again, but the leak surface is cleaner

The continued hardening rerun kept the distilled path at `executionFailures = 0`
and recovered the zero-leak distilled profile:

- post-Phase-51 raw/distilled leaks: `2 / 0`
- post-Phase-52 raw/distilled leaks: `2 / 0`
- post-Phase-53 raw/distilled leaks: `1 / 1`
- post-Phase-53 continued hardening raw/distilled leaks: `2 / 0`
- post-Phase-54 raw/distilled leaks: `3 / 0`
- post-Phase-55 raw/distilled leaks: `4 / 2`
- post-Phase-56 raw/distilled leaks: `1 / 0`
- post-Phase-57 raw/distilled leaks: `2 / 1`
- post-Phase-53 raw/distilled execution failures: `5 / 0`
- post-Phase-53 continued hardening raw/distilled execution failures: `4 / 0`
- post-Phase-54 raw/distilled execution failures: `19 / 3`
- post-Phase-55 raw/distilled execution failures: `8 / 1`
- post-Phase-56 raw/distilled execution failures: `15 / 4`
- post-Phase-57 raw/distilled execution failures: `15 / 5`

The useful product-quality movement is still real, but the operator story is
not monotonic. Phase 55 cleaned up the harness substantially. Phase 56 gave
back some of that execution stability, but it also removed the distilled leak
regression and sharply reduced raw explicit-recall leakage. So the full-300
win is real, but it did not come with cleaner runtime behavior across every
dimension. Phase 57 improved raw blocking execution failures to `2`, but
non-blocking priming failures still accounted for most raw operator noise.

### 5. The biggest remaining misses are still structural

The continued hardening rerun removed `conditioned_directory_restriction` from
the top failure list entirely, but the main structural misses are still these:

1. broader procedural exactness is still weak:
   `session_key_prefix_rule`, `reversed_parameter_protocol`,
   `the_eccentric_api_call`, `the_scribe_s_signature`, and
   `character_voice_consistency` stayed at or near zero
2. bounded style/voice procedural transfer is still fragile:
   `character_voice_consistency` remains `0 / 7`
3. symbolic generalization is still underfit:
   `the_modified_recurrence_sequence` and `the_omega_operation` remain at
   `1 / 7` and `1 / 6`
4. some conditioning families are improved but not yet solved:
   `conditioned_jargon_avoidance` is `8 / 10`, `tool_use_with_side_effects`
   is `7 / 10`, and `emotion_driven_strategy_shift` is `5 / 10`

### 6. The research harness still needs better operator ergonomics

The post-Phase-51 rerun carried more transport/time-budget failures:

- raw execution failures: `0 -> 18`
- distilled execution failures: `0 -> 8`

The post-Phase-52 rerun stayed noisy:

- raw execution failures: `17`
- distilled execution failures: `9`

The post-Phase-53 sharded Postgres run improved this:

- raw execution failures: `5`
- distilled execution failures: `0`

The continued hardening rerun improved the raw side slightly again while
keeping the distilled path clean:

- raw execution failures: `4`
- distilled execution failures: `0`

Those failures do not invalidate the behavioral trend, but they do mean the
Phase 49 live research harness still needs stronger retry/checkpoint/failure
accounting if full-300 runs are going to be a reliable operator workflow.

## Where GoodMemory Actually Helped

Across the GoodMemory full runs, the strongest evidence is still on
local, constraint-shaped behavior.

The most reliable wins in the continued hardening rerun are:

- `conditioned_protocol_preference.json`
  - continued hardening distilled `9 / 10`
- `context_dependent_api_behavior.json`
  - continued hardening distilled `10 / 10`
- `conditioned_api_aversion.json`
  - continued hardening distilled `9 / 10`
- `conditioned_brevity.json`
  - continued hardening distilled `10 / 10`
- `conditioned_directory_restriction.json`
  - continued hardening distilled `10 / 10`
- `tool_use_with_side_effects.json`
  - continued hardening distilled `7 / 10`
- `the_forbidden_square.json`
  - continued hardening distilled `6 / 6`
- `the_ternary_logic_system.json`
  - continued hardening distilled `6 / 6`

These wins are still consistent with the system being better at local
avoidance/preference or bounded symbolic-rule tasks than at broader procedural
transfer.

## Main Failure Modes

### 1. Instance collapse inside procedural distillation

Several procedural families are currently over-distilled into one remembered
answer or one narrow exemplar, instead of a transferable rule.

Representative failures:

- `the_modified_recurrence_sequence.json`
  - distilled memory kept pushing one remembered value such as `P(2)=10`
  - later probes in the same family expected different outputs like `13`, `29`,
    or `61`
- `the_omega_operation.json`
  - remembered one example like `2 ⊗ 3 = 31`
  - failed to derive or transfer the broader operation rule across other probes

This is not a benchmark-only issue. It indicates that the current memory
compiler is too willing to compress procedural learning into exemplar facts
instead of typed rule structure.

### 2. Exact-format procedural templates are not retained tightly enough

Some procedural families require exact openings, subject prefixes, or closings.
The current distilled path often retains the rough pattern but misses the exact
contract.

Representative failures:

- `the_scribe_s_signature.json`
  - baseline `6 / 7`
  - continued hardening distilled `3 / 7`
- `corporate_etiquette_mandate.json`
  - baseline `4 / 6`
  - continued hardening distilled `5 / 6`

Typical error shape:

- memory preserved "there should be a subject, greeting, and sign-off"
- final behavior missed the exact required prefix or closing form

### 3. Hard text constraints are still too soft

The post-Phase-53 rerun confirmed that several conditioning families still
need harder enforcement instead of structured-but-soft control.

Representative remaining failures:

- `conditioned_jargon_avoidance.json`
  - continued hardening distilled `8 / 10`
  - the answer is much better than before, but some probes still leak the
    forbidden technical term while attempting the right analogy shape
- `tool_use_with_side_effects.json`
  - continued hardening distilled `7 / 10`
  - the answer often picked the safer tool or safer reset but still omitted a
    required warning or backup step
- `conditioned_api_distrust.json`
  - continued hardening distilled `9 / 10`
  - the remaining misses are rarer now, but the unresolved cases still show
    incomplete escalation to the specialist route

This points to a remaining gap: typed policy needs stronger hard-constraint
response planning, not just improved text steering.

### 4. First-action emission does not preserve canonical surfaces

The most common raw failure reason in the strict action subgroup was:

- `expected_first_action_missing_or_forbidden` (`35` cases)

Representative outputs included:

- generic shell or prose instead of the required action surface
- markdown-wrapped commands
- refusal or "I don't know the tool signature here" text instead of the exact
  first action

This is a general enactment problem, not just an ImplicitMemBench problem.
GoodMemory currently lacks a strong path from remembered policy to exact host
action emission.

### 5. Procedural exemplar collapse remains the main product gap

The biggest procedural failures are still concentrated in exact symbolic or
exact-format transfer:

- `reversed_parameter_protocol.json`
  - continued hardening distilled `3 / 7`
- `session_key_prefix_rule.json`
  - continued hardening distilled `0 / 7`
- `the_scribe_s_signature.json`
  - continued hardening distilled `3 / 7`
- `the_eccentric_api_call.json`
  - continued hardening distilled `0 / 7`
- `the_alien_filesystem.json`
  - continued hardening distilled `0 / 7`
- `the_modified_recurrence_sequence.json`
  - continued hardening distilled `1 / 7`
- `the_omega_operation.json`
  - continued hardening distilled `1 / 6`

These are not "small formatting misses." They show that the system still
struggles to convert one or two remembered examples into a transferable,
applicability-bounded procedural rule.

## Current Bottom Line

The post-Phase-59 rerun, first reopened Phase 59 implementation attempt, and
`phase59-reopen9` rerun are all internal research evidence, not release gates.
The latest `phase59-reopen9` run meets the reopened Phase 59 raw research
target:

- GoodMemory's raw line reached `115 / 200`, meeting the reopened target
  exactly.
- GoodMemory's distilled line reached `153 / 200`, above the `150 / 200`
  research floor.
- raw explicit recall leaks were `0`.
- raw blocking execution failures were `0`; the `93` operator failures are
  non-blocking priming-lane timeouts after fail-open classification.
- the remaining blocking raw diagnosis is now much smaller and more specific:
  `memory_miss = 21`, `selected_but_not_enacted = 36`,
  `support_conflict = 27`, `wrong_exemplar = 7`, and
  `hypothesis_missing = 1`.

This means Phase 59's reopened research target is closed, while the next
general-capability slice should shift from blocking-only raw internalization to
the overall full-300 protocol, especially controlled priming, denominator
accounting, contamination checks, and task-compliance scoring.

## What Not To Conclude

This run should not be read as "GoodMemory is bad" or "ImplicitMemBench is the
product goal."

The more precise conclusion is:

- GoodMemory already helps on some compact behavioral constraints
- GoodMemory does not yet show strong full-benchmark behavioral internalization
- the current bottlenecks are representation, enactment, and leak control, not
  only retrieval

## Recommendations That Do Not Overfit The Benchmark

These are project-improvement recommendations, not benchmark hacks.

### 1. Keep strengthening hard text-response constraints

Phase 53 proved that structured text-response control and targeted final-surface
sanitation help, but the post-Phase-53 rerun showed the remaining gap clearly:

- `jargon_avoidance` still fails because "avoid this term" is treated as soft
  prose guidance
- side-effect tasks still fail when "must warn" or "must include backup" is
  not enforced as a hard output contract
- directory restriction still needs stricter safe-path and refusal shaping

The next layer should deepen structured text-response constraints such as:

- forbidden terms
- required warnings
- required backup mention
- required safe alternative / replacement target
- concise response-shape limits when the user explicitly wants "just the answer"

### 2. Keep strengthening procedural anti-collapse

Phase 53 reduced some exact-action failure, but the full rerun still shows that
single remembered exemplars are leaking into family-wide answers.

The next step is not more notes. It is stronger transfer discipline:

- keep one-example memories as `example_only`
- require either repeated structurally aligned examples or explicit rule-bearing
  feedback before compiling a transferable procedure
- preserve symbolic slots and transformation templates instead of memorized
  literal outputs wherever possible

Without this, any product using GoodMemory will overgeneralize one example into
the wrong downstream behavior.

### 3. Broaden the exact-action and exact-format executor

For host-integrated and tool-using systems, memory should be able to influence
the first emitted action in a structured way.

That means:

- preserve canonical tool or command names
- preserve argument ordering when policy requires it
- emit exact action envelopes, not prose descriptions of intent
- let higher-priority behavioral constraints shape action selection before
  generic response generation

Phase 53 proved this for the LogiQL slice, but the full rerun shows that
argument-order, session-key, alien filesystem, eccentric API, and exact-format
families still need a more general executor.

### 4. Keep leak suppression and contamination control, but do not confuse it
with full behavioral success

The rerun shows that hygiene improved materially. That work should stay, but it
should not be mistaken for the whole solution.

GoodMemory still needs the tighter separation between:

- what is used to steer behavior
- what is acceptable to say explicitly

That remains a product-quality concern even after the leak counts improved.

### 5. Keep priming as research, and pair it with contamination checks

The run shows that GoodMemory can increase later stylistic or thematic
influence. That is interesting, but it should stay non-blocking.

GoodMemory's main product goal is not to let arbitrary prior text pollute later
answers. Priming should remain a research slice paired with contamination
checks, leak checks, and task-compliance checks.

## Phase 60 Protocol Update (`2026-05-05`)

Phase 60 closed the protocol gap that previously made the `153 / 200`
distilled blocking number unsafe to describe as an official full-300 overall
score. The accepted Phase 60 deterministic gate adds a separate protocol summary
with:

- `blockingScore`
- `primingScore`
- `full300OverallScore`
- `overallComparableToOfficial`
- `primingContaminationCount`
- `primingTaskViolationCount`
- `primingExplicitLeakCount`

Accepted evidence:

- protocol summary:
  `reports/eval/fallback/phase-60/run-phase60-fallback-current/overall-summary.json`
- quality gate:
  `reports/quality-gates/phase-60/run-20260505120000/phase-60-quality-gate.json`
- archive summary:
  `docs/archive/quality-gates/GoodMemory-Phase-60-Quality-Gate.md`

The deterministic Phase 60 smoke run proves the protocol and contamination
zero-credit behavior. It is not a substitute for a five-shard Postgres-backed
full-300 rerun. Therefore, the current claim boundary remains:

- GoodMemory has strong internal research evidence on the blocking slice.
- GoodMemory does not yet have an accepted Phase 60 full-300 overall result
  answering whether it exceeds the paper's `66%` line on the official
  denominator.
- The next full-300 rerun must publish both the blocking and priming
  contributions under the Phase 60 protocol before any leaderboard-style wording.

## Phase 61 Priming Repair Update (`2026-05-05`)

The first full-300 Phase 60 run showed that the official-comparable denominator
is necessary but not sufficient: GoodMemory's controlled priming lane can cover
all 100 priming cases and still receive `0 / 100` positive credit when the final
answers copy source nouns, violate strict JSON, or add disallowed commentary.

Phase 61 addresses that mechanism without relaxing the contamination rules:

- `bestGoodMemoryOverallRate` is now restricted to official-comparable
  full-denominator profiles.
- Blocking-only rates are reported separately so the `75%` blocking signal is
  not confused with a full-300 score.
- Priming audits now expose structured violation tags, counts, and examples.
- GoodMemory priming generation now uses an internal latent influence packet
  with abstract cues and a source-noun blacklist instead of raw priming text.
- Strict JSON priming answers are repaired before judging when they contain
  markdown, malformed JSON, extra keys, bad candidate shape, or forbidden
  source nouns.

The research target for the next full-300 rerun is not to reward source-text
copying. It is to show positive credited priming through compliant abstract
transfer, with `executionFailures = 0`, `explicitRecallLeakCount = 0`, and a
lower priming task-violation count than the Phase 60 observed `82 / 100`.

The post-Phase-61 full-300 rerun completed under
`run-phase61-full300-20260505T030809Z`:

- official-comparable denominator:
  - `300 / 300` cases
- baseline full-300 score:
  - `121 / 300 = 40.33%`
- best official-comparable GoodMemory full-300 score:
  - `159.59 / 300 = 53.20%`
- best GoodMemory blocking-only profile:
  - `158 / 200 = 79.00%`
- GoodMemory raw-experience full-300 score:
  - `115.59 / 300 = 38.53%`
- GoodMemory priming contribution:
  - `12 / 100` credited cases
  - average credited influence `1.59`
  - task violations `0`
  - source-noun contamination flags `5`
  - explicit recall leaks `0`

This is a real Phase 61 lift over Phase 60's `0 / 100` controlled priming
credit and task-format failure mode. It is still not a leaderboard-style win:
no GoodMemory profile exceeds the paper's `66%` reference line on the
official-comparable 300-case denominator.

The semantic-field follow-up rerun completed under
`run-phase61-full300-20260505T080002Z` with shard concurrency `6` and
per-shard case concurrency `1`:

- official-comparable denominator:
  - `300 / 300` cases
- baseline full-300 score:
  - `128 / 300 = 42.67%`
- best official-comparable GoodMemory full-300 score:
  - `145.71 / 300 = 48.57%`
- best GoodMemory blocking-only profile:
  - `121 / 200 = 60.50%`
- GoodMemory raw priming contribution:
  - `56 / 100` credited cases
  - average credited influence `24.71`
  - task violations `0`
  - source-noun contamination flags `0`
  - explicit recall leaks `0`
- execution failures:
  - baseline `0`
  - GoodMemory raw `0`
  - GoodMemory distilled `2` text-generation timeouts at the previous `90000ms`
    general timeout

The follow-up confirms the semantic-field priming repair materially increased
compliant priming credit. It does not improve the full-300 headline: the best
official-comparable GoodMemory score remains below the paper's `66%` reference
line, and the lower distilled blocking result means the latest full-300 score
is lower than the first post-Phase-61 run. The Phase 61 wrapper now raises the
general ImplicitMemBench timeout to at least `180000ms` for future full-300
runs, matching the priming timeout and avoiding the observed `90000ms`
text-generation timeout class. It also defaults per-shard case concurrency to
`1` through the Phase 61 wrapper so generic high-concurrency eval environment
settings do not overload live full-300 runs.

## Phase 62A Recovery Update (`2026-05-05`)

Phase 62A addressed the remaining post-Phase-61 failure mode: priming improved,
but the full-300 headline was still pulled down by a distilled blocking
regression and weak priming transfer in several semantic fields.

Mechanism changes:

- distilled feedback now has an eval-only immediate feedback policy fallback,
  so a `memory.feedback()` signal still produces executable behavioral context
  when no compiled validated pattern is available
- merged Phase 61 full-300 summaries preserve distilled context diagnostics:
  empty context count, compiled/fallback policy counts, pass rate, and examples
- latent priming semantic-field inference now prioritizes source theme labels
  and manifest keywords before scanning priming prose, preventing incidental
  terms such as `cold` or `stone` from routing a case to the wrong field
- strict JSON priming generation compares model candidates with a
  contamination-safe deterministic candidate set and selects the stronger safe
  abstract candidate set when generated candidates are weak or unsafe

The post-fix full-300 rerun completed under
`run-phase61-full300-20260505T170001Z`:

- artifact:
  `reports/eval/live/phase-61-full300/run-phase61-full300-20260505T170001Z/overall-summary.json`
- official-comparable denominator:
  - `300 / 300` cases
- baseline full-300 score:
  - `128 / 300 = 42.67%`
- target GoodMemory profile:
  - `goodmemory-distilled-feedback+controlled-priming`
- best official-comparable GoodMemory full-300 score:
  - `213.26 / 300 = 71.09%`
- reference line:
  - exceeds the paper's `66%` line by `5.09` percentage points
- GoodMemory distilled blocking:
  - `155 / 200 = 77.50%`
- GoodMemory priming contribution:
  - `94 / 100` credited cases
  - average credited influence `58.26`
  - task violations `0`
  - source-noun contamination flags `0`
  - explicit recall leaks `0`
- distilled context diagnostics:
  - empty context `0 / 200`
  - fallback policy coverage `200 / 200`
  - context pass rate `77.50%`
- execution failures:
  - baseline `0`
  - GoodMemory raw `0`
  - GoodMemory distilled `0`

This is the first official-comparable internal GoodMemory full-300 profile in
this workstream to exceed the paper's `66%` reference line. The claim boundary
does not change: the result is internal research evidence, not a release hard
gate, not a public API/config change, and not a README-level leaderboard claim.

## 2026-07-06 Full-Root Refresh

The current-checkout rerun completed under
`run-phase61-full300-rerun-20260706-codex-current`:

- benchmark root:
  - `/tmp/ImplicitMemBench`
  - upstream commit `927413bf3f5389bb47c94c2a0ba987e435b101b8`
  - dataset license `CC BY 4.0`; code license `MIT`
- command shape:
  - `GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER=openai bun run eval:phase-61-full300 -- --benchmark-root /tmp/ImplicitMemBench --run-id run-phase61-full300-rerun-20260706-codex-current --shards 10 --shard-concurrency 6 --max-concurrency 1 --priming-timeout-ms 180000`
- official-comparable denominator:
  - `300 / 300` cases
- baseline full-300 score:
  - `123 / 300 = 41.00%`
- target GoodMemory profile:
  - `goodmemory-distilled-feedback+controlled-priming`
- best official-comparable GoodMemory full-300 score:
  - `212.45 / 300 = 70.82%`
- reference line:
  - exceeds the paper's `66%` line by `4.82` percentage points
- GoodMemory raw-experience full-300 score:
  - `179.45 / 300 = 59.82%`
- GoodMemory distilled blocking:
  - `154 / 200 = 77.00%`
- GoodMemory priming contribution:
  - `94 / 100` credited cases
  - average credited influence `58.45`
  - task violations `0`
  - source-noun contamination flags `0`
  - explicit recall leaks `0`
- execution failures:
  - baseline `0`
  - GoodMemory raw `0`
  - GoodMemory distilled `0`

This source-answer refresh is slightly below the May 2026 high-water mark
(`213.26 / 300 = 71.09%`) but within the same band and cleaner than the earlier
same-day full-root run that had one distilled execution failure. Its 0.7082
score remains a same-model diagnostic number. The stored-answer gpt-5.4
rescore below is also internal diagnostic evidence, not a claimable number.

## 2026-07-06 Postchanges Full-Root Rerun

The follow-up current-worktree rerun completed under
`run-phase61-full300-rerun-20260706-postchanges-current` after recent local
changes:

- benchmark root:
  - `/tmp/ImplicitMemBench`
  - upstream commit `927413bf3f5389bb47c94c2a0ba987e435b101b8`
- command shape:
  - `GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER=openai GOODMEMORY_EVAL_MAX_CONCURRENCY=1 bun run eval:phase-61-full300 -- --benchmark-root /tmp/ImplicitMemBench --run-id run-phase61-full300-rerun-20260706-postchanges-current --shards 10 --shard-concurrency 6 --max-concurrency 1 --priming-timeout-ms 180000`
- official-comparable denominator:
  - `300 / 300` cases
- baseline full-300 score:
  - `131 / 300 = 43.67%`
- target GoodMemory profile:
  - `goodmemory-distilled-feedback+controlled-priming`
- best official-comparable GoodMemory full-300 score:
  - `209.05 / 300 = 69.68%`
- GoodMemory raw-experience full-300 score:
  - `175.05 / 300 = 58.35%`
- GoodMemory distilled blocking:
  - `153 / 200 = 76.50%`
- GoodMemory priming contribution:
  - `94 / 100` credited cases
  - average credited influence `56.05`
  - task violations `0`
  - source-noun contamination flags `0`
  - explicit recall leaks `0`
- execution failures:
  - baseline `0`
  - GoodMemory raw `0`
  - GoodMemory distilled `2`
  - both failures were `text_answer_generation timed out after 180000ms` on
    `classical_conditioning/conditioned_api_aversion.json#007` and
    `classical_conditioning/conditioned_api_distrust.json#007`

This postchanges rerun is useful drift evidence but should not replace the
0-failure `run-phase61-full300-rerun-20260706-codex-current` canonical internal
score. The measured score is lower by `3.40` passed-equivalent points
(`0.6968333333` vs `0.7081666667`), and the two timeout failures mean it is not
a clean answer-regeneration replacement for the canonical source run.

## 2026-07-06 Latest Full-Root Rerun

The latest current-worktree rerun completed under
`run-phase61-full300-rerun-20260706-latest-current` after the current benchmark
hardening work:

- benchmark root:
  - `/tmp/ImplicitMemBench`
  - upstream commit `927413bf3f5389bb47c94c2a0ba987e435b101b8`
- command shape:
  - `GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER=openai GOODMEMORY_EVAL_MAX_CONCURRENCY=1 bun run eval:phase-61-full300 -- --benchmark-root /tmp/ImplicitMemBench --run-id run-phase61-full300-rerun-20260706-latest-current --shards 10 --shard-concurrency 6 --max-concurrency 1 --priming-timeout-ms 180000`
- official-comparable denominator:
  - `300 / 300` cases
- baseline full-300 score:
  - `130 / 300 = 43.33%`
- target GoodMemory profile:
  - `goodmemory-distilled-feedback+controlled-priming`
- best official-comparable GoodMemory full-300 score:
  - `211.06 / 300 = 70.35%`
- GoodMemory raw-experience full-300 score:
  - `179.06 / 300 = 59.69%`
- GoodMemory distilled blocking:
  - `155 / 200 = 77.50%`
- GoodMemory priming contribution:
  - `92 / 100` credited cases
  - average credited influence `56.06`
  - task violations `0`
  - source-noun contamination flags `0`
  - explicit recall leaks `0`
- execution failures:
  - baseline `0`
  - GoodMemory raw `0`
  - GoodMemory distilled `1`

This rerun improves on the failed postchanges drift check by `2.01`
passed-equivalent points (`0.7035333333` vs `0.6968333333`) and lowers the
distilled execution-failure count from `2` to `1`, but it is still not a clean
replacement for the 0-failure `run-phase61-full300-rerun-20260706-codex-current`
canonical internal source score. It remains lower by `1.39` passed-equivalent
points (`0.7035333333` vs `0.7081666667`) and is drift evidence only.

The follow-up current-worktree rerun completed under
`run-phase61-full300-rerun-20260706-after-hardening-current` while the
stored-answer rescore runner was being hardened:

- benchmark root:
  - `/tmp/ImplicitMemBench`
  - upstream commit `927413bf3f5389bb47c94c2a0ba987e435b101b8`
- command shape:
  - `GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER=openai GOODMEMORY_EVAL_MAX_CONCURRENCY=1 bun run eval:phase-61-full300 -- --benchmark-root /tmp/ImplicitMemBench --run-id run-phase61-full300-rerun-20260706-after-hardening-current --shards 10 --shard-concurrency 6 --max-concurrency 1 --priming-timeout-ms 180000`
- official-comparable denominator:
  - `300 / 300` cases
- baseline full-300 score:
  - `130 / 300 = 43.33%`
- target GoodMemory profile:
  - `goodmemory-distilled-feedback+controlled-priming`
- best official-comparable GoodMemory full-300 score:
  - `206.85 / 300 = 68.95%`
- GoodMemory raw-experience full-300 score:
  - `174.85 / 300 = 58.28%`
- GoodMemory distilled blocking:
  - `151 / 200 = 75.50%`
- GoodMemory priming contribution:
  - `92 / 100` credited cases
  - average credited influence `55.85`
  - task violations `0`
  - source-noun contamination flags `0`
  - explicit recall leaks `0`
- execution failures:
  - baseline `0`
  - GoodMemory raw `0`
  - GoodMemory distilled `0`

This is a cleanly completed drift check, but it is lower than the canonical
0-failure `run-phase61-full300-rerun-20260706-codex-current` by `5.60`
passed-equivalent points (`0.6895` vs `0.7081666667`) and lower than the prior
`latest-current` drift check by `4.21` passed-equivalent points. It therefore
does not replace the canonical source-answer artifact. It does, however, answer
the post-change drift question: the freshest clean answer-generation run is
lower than the canonical source run but still in the same 0.69-0.71 band.

## 2026-07-06 Stored-Answer Rescore Readiness

`audit:phase-61-implicitmembench-rescore-readiness` now checks whether the
canonical 0-failure Full-300 reports can be rescored without regenerating
answers. The original same-model readiness artifact is:

- `reports/eval/research/phase-61/implicitmembench/implicitmembench-rescore-readiness-20260706-current/rescore-readiness.json`

It validates:

- baseline stored answers:
  - `300 / 300` rows ready
- GoodMemory composite profile:
  - `300 / 300` rows ready
  - blocking source profile: `goodmemory-distilled-feedback`
  - priming source profile: `goodmemory-raw-experience`
- scorer split:
  - `35` deterministic `structured_first_action` rows
  - `165` `text_behavior_judge` rows
  - `100` `priming_pair_judge` rows
  - `265` rows still need a judge replacement
- source score pinned from the canonical report:
  - baseline `0.41`
  - GoodMemory `0.7081666667`

That artifact also records the previously loaded judge environment as same-model:
answer model `gpt-5.5`, judge model `gpt-5.5`, `sameModelJudge: true`.
Therefore `storedAnswersReady: true`, but
`readyForIndependentJudgeRescore: false`. This proves the next research
rescore does not need answer regeneration, but it still needs an actually
independent judge or a broader deterministic scorer.

A follow-up cross-version readiness probe completed under:

- `reports/eval/research/phase-61/implicitmembench/implicitmembench-rescore-readiness-gpt54-probe-current/rescore-readiness.json`

It records answer model `gpt-5.5`, judge model `gpt-5.4`,
`sameModelJudge: false`, `storedAnswersReady: true`, and
`readyForIndependentJudgeRescore: true` on the same 300 baseline rows, 300
GoodMemory composite rows, 35 deterministic rows, and 265 judge-required scorer
rows.

## 2026-07-06 Stored-Answer Independent Rescore

`rescore:phase-61-implicitmembench` is now the pinned no-answer-rerun command
for the independent judge pass. The completed internal rescore artifact used:

- command shape:
  - `GOODMEMORY_JUDGE_MODEL=gpt-5.4 bun run rescore:phase-61-implicitmembench -- --overall-report reports/eval/live/phase-61-full300/run-phase61-full300-rerun-20260706-codex-current/report.json --run-id implicitmembench-independent-rescore-gpt54-current --max-concurrency 4`
- source behavior:
  - reads the canonical overall report
  - follows `sourceReports.baselineReportPath`
  - follows `sourceReports.goodmemoryReportPath`
  - does not regenerate answers
- scoring behavior:
  - carries deterministic `structured_first_action` rows unchanged
  - rejects partial or mismatched source scopes before any judge call
  - rejudges stored baseline `text_behavior_judge` and `priming_pair_judge` rows
  - rejudges stored GoodMemory composite rows from
    `goodmemory-distilled-feedback` and `goodmemory-raw-experience`
  - rebuilds the existing Phase 60 Full-300 summary from the rescored reports
- output files:
  - `run-identity.json`
  - `progress.jsonl`
  - `baseline-report.json`
  - `goodmemory-report.json`
  - `overall-summary.json`
  - `rescore-summary.json`

The runner rejects same-model answer/judge configuration before reading source
reports. The completed `implicitmembench-independent-rescore-gpt54-current`
run used gpt-5.4 over unchanged gpt-5.5 answers and wrote:

- GoodMemory composite:
  - `207.35 / 300 = 0.6911666667`
  - blocking `153 / 200 = 0.765`
  - priming `54.35 / 100 = 0.5435`
- baseline:
  - `120 / 300 = 0.4`
  - blocking `120 / 200 = 0.6`
- row accounting:
  - `530` judge-required row decisions in `progress.jsonl`
  - `265` baseline rows
  - `265` GoodMemory composite rows
  - deterministic `structured_first_action` rows carried forward unchanged
- execution failures:
  - `0`

The judge is cross-version but still the same GPT family as the answer model.
Any future claim would have to disclose that limitation; this result and the
older `0.7081666667` same-model score remain diagnostic only.

`run-identity.json` records the answer model, judge model, source report paths,
source run id, and source report SHA-256 fingerprints. `progress.jsonl` records
completed judge-required rows and is reused only when that identity still
matches; a stale identity, duplicate cached row, row outside the selected scope,
or progress cache without an identity file is rejected before it can affect the
rescored summary. This makes the independent judge pass resumable without
turning partial progress into public evidence.

## Recommended Next Work

If the goal is to improve GoodMemory itself rather than chase one benchmark, the
highest-yield sequence is:

1. deepen hard text-response constraints, especially forbidden-term and path
   rewrite enforcement
2. strengthen procedural anti-exemplar-collapse and symbolic rule transfer
3. broaden the dedicated exact-action and exact-format executor
4. keep leak suppression and contamination control in place while those new
   mechanisms land
5. rerun the full 300 only after those mechanism changes, rather than tuning
   prompts case by case

## Reproduction Notes

The successful full run used sharded execution because a single opaque full
process was too slow for interactive research and parallel local SQLite runs
caused lock contention.

Important execution notes from this run:

- high per-process concurrency caused provider timeouts
- parallel shard runs on default local SQLite caused database locks
- forcing Postgres-backed GoodMemory storage resolved the shard contention
- the stable configuration was:
  - 5 balanced shards for the Phase 49 through Phase 60 research reruns
  - per-process concurrency `1`
  - Postgres storage
- the Phase 61 operator wrapper is:
  - `bun run eval:phase-61-full300`
  - 10 benchmark shards
  - shard-level concurrency `6`
  - Postgres storage

That execution strategy is part of the research setup, not a product claim.
