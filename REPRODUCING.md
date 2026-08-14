# Reproducing GoodMemory's Benchmark Claims

Every number in the README's public-claims table is backed by a committed
declaration in [`benchmark-claims/`](./benchmark-claims/) that records the
exact command, commit, package version, judge/scorer, dataset source and
license, and every required disclosure. The claim gate enforces the rules:

```bash
bun run gate:public-benchmark-claim -- --strict
```

A benchmark may appear in the README public table only when its declaration
passes with zero blockers, and the gate cross-checks the README tables in
both languages against the declarations.

## The two tracks

- **Strict track** — deterministic or judge-free scoring (token-F1, exact,
  contains, numeric, abstention). A hard lower bound no LLM judge can
  inflate.
- **Comparable track** — the *same stored answers* re-judged under the
  benchmark's official or industry-standard judge protocol, verbatim, so the
  number is on the same scale as published competitor results:
  [`scripts/rescore-official-protocols.ts`](./scripts/rescore-official-protocols.ts)
  embeds the LongMemEval `evaluate_qa.py` prompts, the mem0
  `memory-benchmarks` LoCoMo judge, and the official BEAM unified rubric
  judge, and writes resumable per-item verdicts plus a summary.

## Per-benchmark recipes

Datasets are fetched at eval time from their upstream sources and are never
vendored into this repository. Set the model env groups (`GOODMEMORY_EVAL_*`
for answers, `GOODMEMORY_JUDGE_*` for comparable-track judging) before
running; the judge model must differ from the answer model and is recorded in
each declaration.

### LongMemEval (full 500)

```bash
# answers + deterministic scoring (resumable shards)
bun run scripts/run-phase-62-full500.ts --benchmark-root <root with longmemeval_s.json> \
  --profile goodmemory-rules-only --profile baseline-no-memory \
  --shard-concurrency 4 --run-id <run-id> --resume-existing-shards
# strict track (judge-free deterministic subset)
bun run scripts/run-phase-62-deterministic-subset.ts --report-path <runDir>/report.json \
  --claim-profile goodmemory-rules-only
# comparable track (official evaluate_qa.py protocol over the same answers)
bun run scripts/rescore-official-protocols.ts --benchmark longmemeval
```

### MemoryAgentBench (CR, TTL)

```bash
bun run scripts/prepare-phase-64-memory-agent-bench-data.ts --output-root <root>
bun run scripts/run-phase-64-memory-agent-bench-smoke.ts --benchmark-root <root> --live --resume --run-id <run-id>
```

Deterministic scoring, no judge. AR and LRU are excluded by declaration: the
no-memory ablation scores them higher (multiple-choice leakage).

### LoCoMo (full 10 conversations)

```bash
bun run scripts/prepare-phase-65-locomo-data.ts -- --output-root <root> \
  --max-conversations 10 --max-questions-per-case 0
bun run scripts/measure-locomo-union-live.ts --benchmark-root <root> \
  --union-topk 16 --with-extraction --concurrency 6 --run-id <run-id> --resume
# baseline: same command with --no-memory
# comparable track (industry LLM-judge protocol over the same answers)
bun run scripts/rescore-official-protocols.ts --benchmark locomo --root <root>/cases.json
```

Dataset license is CC BY-NC 4.0 (non-commercial) — disclosed in the
declaration and the README.

### BEAM (100K split)

```bash
bun run scripts/prepare-phase-63-beam-data.ts --output-root <root> --split 100K
bun run scripts/run-beam-union16-live-closure.ts --run-id <run-id>   # or the
# rules-only closure via scripts/run-phase-63-beam-live-closure.ts (see beam.json for the
# exact claimed command)
# comparable track (official unified rubric judge, all 1051 rubric items)
bun run scripts/rescore-official-protocols.ts --benchmark beam
```

Recall is always reported as a dual metric per
[ADR-005](./adr/ADR-005-scenario-fitted-recall-boundary.txt): `fitted` (all
narrow gates on) and `generalization` (all gates disabled via
`GOODMEMORY_DISABLED_NARROW_GATES`).

## What we will not do

- Report retrieval recall as answer accuracy.
- Use an undisclosed same-model judge, or hide the judge protocol.
- Hand-code per-question boosts to a benchmark's failing cases (see ADR-005
  for how scenario-fitted logic is quarantined and disclosed when it exists).
- Publish a number whose run had execution failures, no baseline, or an
  unverifiable dataset.
