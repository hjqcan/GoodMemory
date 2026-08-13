# GoodMemory Phase 59 Quality Gate

Canonical accepted gate run: `run-20260504193000`

Historical note: this document and its tracked artifact describe the retired
transcript/archive inference path. The regeneration commands below are retained
as provenance, not as current instructions; current typed-outcome validation
requires raw `0 / 60`, distilled at least `56 / 60`, and gate run
`run-20260813090000`, without overwriting this artifact.

Phase 59 closes Generalized Raw Executor Cleanup as a targeted internal
mechanism slice. It keeps the public API/config and durable memory taxonomy
unchanged while replacing Phase 58 surface-aware hardening with generalized
raw-experience extraction and deterministic execution contracts.

Full-300 research follow-up note: the targeted gate remains the accepted release
gate. Phase 59 was reopened after an earlier five-shard Postgres-backed
full-300 research follow-up landed at raw `88 / 200` against the `115 / 200`
raw research target. The later `phase59-reopen9` rerun reached the internal
research target at raw `115 / 200`, distilled `153 / 200`, raw blocking
execution failures `0`, and raw explicit recall leaks `0`. This does not
upgrade full-300 into a release gate or public claim.

## Evidence

- Deterministic targeted eval:
  - `reports/eval/fallback/phase-59/run-phase59-fallback-current/report.json`
  - Regenerate with
    `bun run eval:phase-59 -- --run-id run-phase59-fallback-current`
- Raw diagnosis report:
  - `reports/eval/fallback/phase-59/run-phase59-fallback-current/raw-diagnostics.json`
  - Regenerate with
    `bun run eval:phase-59-diagnostics -- --report reports/eval/fallback/phase-59/run-phase59-fallback-current/report.json --output reports/eval/fallback/phase-59/run-phase59-fallback-current/raw-diagnostics.json`
- Quality gate:
  - `reports/quality-gates/phase-59/run-20260504193000/phase-59-quality-gate.json`
  - Regenerate with `bun run gate:phase-59`
- Full-300 research follow-up summary:
  - `reports/quality-gates/phase-59/run-20260504193000/phase-59-reopen9-full300-research-summary.json`
  - Local raw diagnostics:
    `/tmp/phase59-reopen9-full300-final-raw-diagnostics-20260504.json`

## Accepted Scope

- generic extraction of `failed_operation -> preferred_operation`,
  `forbidden_surface -> safe_replacement`, `path_root -> safe_anchor`,
  `protocol_from -> protocol_to`, and `filetype_from -> filetype_to` from raw
  learning/interference transcripts
- structured first-action recovery for token prefixes, reversed parameters,
  pipe-separated filesystem paths, LogiQL-like query syntax, and eccentric API
  argument ordering
- symbolic and formula execution for grounded recurrence and binary-operation
  rules, with wrong-exemplar guards for unrelated mathematical-looking traces
- format and voice contracts for required first line, opener, closer,
  sender/name placeholder, one-line header, forbidden style tokens, and
  required style markers
- final post-repair leak suppression after fallback and computed responses
- targeted deterministic evidence proving:
  - `goodmemory-raw-experience` passes `58 / 60`
  - `goodmemory-distilled-feedback` passes `60 / 60`
  - targeted execution failures are `0`
  - targeted explicit recall leaks are `0`
  - raw diagnosis is selected-and-passed `58`, selected-but-not-enacted `2`,
    memory-miss `0`, support-conflict `0`, wrong-exemplar `0`, and
    operator-failure `0`
  - cue-sufficiency diagnosis is passed `58`, cue-disconnect `2`, and `0` for
    no-candidate, candidate-insufficient, conflict, wrong-exemplar, unsafe
    executor, sufficient-not-enacted, and operator-failure buckets

## Gate Coverage

The quality gate requires:

- `bun run typecheck`
- targeted unit/regression suites for Phase 59, raw behavioral exemplars,
  structured behavioral policy repair, diagnosis aggregation,
  ImplicitMemBench research, runner scripts, and runtime-kit controls
- canonical `eval:phase-59` regeneration
- deterministic evidence with raw targeted blocking passes at least `48 / 60`,
  distilled targeted blocking passes at least `56 / 60`, execution failures
  at `0`, and explicit recall leaks at `0`

## Outside The Accepted Claim

- public API or public config widening
- a new durable public memory kind or public record collection
- full-300 ImplicitMemBench as a release hard gate or public product claim
- claiming full-300 as product-release evidence; the `phase59-reopen9`
  five-shard Postgres-backed rerun met the internal Phase 59 research target,
  but remains research-only evidence
- benchmark-specific runtime hacks, task-file-specific patches, or case-id
  routing as the accepted product mechanism
