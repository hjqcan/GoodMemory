# GoodMemory Phase 58 Quality Gate

Canonical accepted gate run: `run-20260504183000`

Historical note: this document and its tracked artifact describe the retired
transcript/archive inference path. The regeneration commands below are retained
as provenance, not as current instructions; current typed-outcome validation
uses `run-phase58-typed-outcome-current` and gate run
`run-20260813083000`, without overwriting this artifact.

Phase 58 closes Raw Enactment Compiler and Repair Loop as a targeted internal
mechanism slice. It keeps the public API/config and durable memory taxonomy
unchanged while compiling selected raw experience into deterministic
inhibition, replacement, exact-format, and repair/fallback controls.

## Evidence

- Deterministic targeted eval:
  - `reports/eval/fallback/phase-58/run-phase58-fallback-current/report.json`
  - Regenerate with
    `bun run eval:phase-58 -- --run-id run-phase58-fallback-current`
- Raw diagnosis report:
  - `reports/eval/fallback/phase-58/run-phase58-fallback-current/raw-diagnostics.json`
  - Regenerate with
    `bun run eval:phase-58-diagnostics -- --report reports/eval/fallback/phase-58/run-phase58-fallback-current/report.json --output reports/eval/fallback/phase-58/run-phase58-fallback-current/raw-diagnostics.json`
- Quality gate:
  - `reports/quality-gates/phase-58/run-20260504183000/phase-58-quality-gate.json`
  - This historical path is reproducible only from its recorded source
    revision. The current `bun run gate:phase-58` writes the separate
    `run-20260813083000` typed-outcome validation artifact.

## Accepted Scope

- raw text-response repair through the internal `TextResponseEnactmentPlan`,
  including deterministic fallback answers when forbidden surfaces survive
  normal rewrite/delete enforcement
- correction-backed raw failure/success pairs compiled into inhibition plus
  preferred replacement rather than default support/conflict abstention
- exact-format contracts for prefix, suffix, and slot-preserving text
  procedures
- raw hard-control fallback packets when selected exemplars abstain but
  experience-derived control evidence is still available
- structured first-action smoke coverage for session-key prefix, reversed
  parameter protocol, alien filesystem, eccentric API, and LogiQL-style action
  forms
- leak suppression after repair and fallback selection
- targeted deterministic evidence proving:
  - `goodmemory-raw-experience` passes `41 / 50`
  - `goodmemory-distilled-feedback` passes `48 / 50`
  - targeted execution failures are `0`
  - targeted explicit recall leaks are `0`
  - raw diagnosis is selected-and-passed `41`, selected-but-not-enacted `6`,
    memory-miss `3`, support-conflict `0`, wrong-exemplar `0`, and
    operator-failure `0`

## Gate Coverage

The quality gate requires:

- `bun run typecheck`
- targeted unit/regression suites for Phase 58, raw behavioral exemplars,
  structured behavioral policy repair, diagnosis aggregation,
  ImplicitMemBench research, runner scripts, and runtime-kit controls
- canonical `eval:phase-58` regeneration
- deterministic evidence with raw targeted blocking passes at least `38 / 50`,
  distilled targeted blocking passes at least `48 / 50`, execution failures
  at `0`, and explicit recall leaks at `0`

## Outside The Accepted Claim

- public API or public config widening
- a new durable public memory kind or public record collection
- full-300 ImplicitMemBench as a release hard gate or public product claim
- claiming the Phase 58 full-300 raw target before the separate five-shard
  Postgres-backed follow-up rerun is executed
- benchmark-specific runtime hacks or task-file-specific patches as the
  accepted product mechanism
