Phase 58 Breakdown: Raw Enactment Compiler and Repair Loop
==========================================================

Boundary
--------
This is an internal research/runtime phase. It does not add a public API,
public config flag, public durable memory kind, or README-facing benchmark
claim. Full-300 remains an internal research follow-up.

Implementation Checklist
------------------------
- [x] Add Phase 58 targeted fixture routing and runner scripts.
- [x] Add deterministic raw text-response fallback repair when forbidden
  surfaces remain after normal rewrite/delete enforcement.
- [x] Compile correction-backed raw failure/success pairs into inhibition and
  preferred replacement operations.
- [x] Compile raw exact-format traces into prefix/suffix and slot-preserving
  text-response contracts.
- [x] Add fallback raw text-response packets when exemplar selection abstains
  but raw hard-control evidence exists.
- [x] Keep leak suppression after repair and fallback answer selection.
- [x] Add Phase 58 diagnosis aggregation and gate command.
- [ ] Re-run full-300 with five Postgres-backed shards and archive the internal
  follow-up summary.

Canonical Commands
------------------
- `bun run typecheck`
- `bun test tests/unit/eval.phase58.test.ts tests/unit/evolution.behavioral-policy.test.ts tests/unit/evolution.raw-behavioral-exemplars.test.ts tests/unit/implicitmembench-diagnostics.test.ts tests/unit/implicitmembench-research.test.ts tests/unit/run-phase-58.script.test.ts tests/unit/runtime-kit.test.ts`
- `bun run eval:phase-58`
- `bun run eval:phase-58-live-memory`
- `bun run eval:phase-58-diagnostics -- --report <report.json> --output <summary.json>`
- `bun run gate:phase-58`

Accepted Targeted Result
------------------------
The figures below describe the historical accepted transcript/archive
inference path. Current typed-outcome regeneration fails closed with zero raw
candidates and selections; its 28 / 50 memory-independent smoke-answer passes
are not raw carryover evidence. Formal `tool_outcome` carryover is covered by
the host, storage, RuntimeKit, and exact-record-ref tests.

- raw blocking: `41 / 50`
- distilled blocking: `48 / 50`
- execution failures: `0`
- explicit recall leaks: `0`
- raw diagnosis: selected-and-passed `41`, selected-but-not-enacted `6`,
  memory-miss `3`, support-conflict `0`, wrong-exemplar `0`,
  operator-failure `0`

Full-300 Follow-Up
------------------
Target follow-up remains research-only:
- raw blocking pass target: at least `60 / 200`, stretch `65 / 200`
- distilled blocking pass target: at least `150 / 200`
- raw explicit recall leak target: `<= 1`
- raw blocking execution failure target: `<= 3`

The follow-up should use the same five-shard Postgres-backed setup used for
Phase 49 full-300 GoodMemory research evals.
