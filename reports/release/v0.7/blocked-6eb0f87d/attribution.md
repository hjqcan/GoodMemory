# v0.7.3 lifecycle protection — blocked run and attribution

Status: **BLOCKED — not release evidence**

This record preserves the first completed v0.7.3 paired protection run. It
must not be used to publish v0.7.3 or to re-pin the 1540-question LoCoMo claim.

## Bound run

- Baseline: `456edd106f29118b3455bf21c43d7b3107b48213` (`v0.7.2^{}`)
- Candidate: `6eb0f87db23957b7910e50f50618b07d3533b45e`
- Bun: `1.3.14`
- Population: `locomo-conv-26` + `locomo-conv-30`, 233 questions
- Both arms used fresh seed, reanswer, and official-judge outputs.
- Both arms completed 233 seed rows, 233 answers, and 233 official judgments
  with zero execution or judge failures.
- Deterministic scenario replay: 8 passed, 0 failed.

The complete manifest, process receipts, raw reports, official progress,
live-delta output, source snapshots, and scenario logs are under
`v0.7.3-lifecycle-evidence/`. The mechanical verdict is
`lifecycle-protection.json`.

## Mechanical result

| Overall metric | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| Evidence recall | 0.8239628040 | 0.8096566524 | -1.4306pt |
| Strict answer score | 0.6027838185 | 0.5778077817 | -2.4976pt |
| Official gpt-5.5 score | 0.9484978541 | 0.9270386266 | -2.1459pt |

The live-delta contained 11 improved and 15 regressed answer transitions.
Because all three overall protection metrics regressed by more than 1.00pt,
the run blocks release and requires attribution.

## Attribution controls

### Same-commit provider retrieval replicate

The exact baseline seed command was replayed at the same baseline commit. Only
the fresh output directory and run ID changed.

| v0.7.2 run | Evidence recall | Fully retrieved |
|---|---:|---:|
| Formal baseline | 0.8239628040 | 179 |
| Same-commit replicate | 0.8059370529 | 176 |

The same-commit delta was **-1.8026pt**, larger than the formal
baseline-to-candidate delta. Retrieved turn sets changed on 227 of 233
questions. This demonstrates that one provider-backed run is not stable at the
pre-registered 1pt evidence-recall threshold.

Raw replicate:
`attribution-controls/baseline-provider-seed-replicate.json`
(`sha256:06b4f397d6738e8e476813b70de41abeccbb3fdad59c7aa5ec2860aef3880404`).

### Provider-free code controls

Both commits were replayed with label-free ingest, generalized fusion, and no
provider extraction, embedding, reranking, answer generation, or judging.

| Concurrency | Baseline | Candidate | Delta | Improved | Regressed |
|---:|---:|---:|---:|---:|---:|
| 1 | 0.2979256080 | 0.3065092990 | +0.8584pt | 2 | 0 |
| 40 | 0.3022174535 | 0.3065092990 | +0.4292pt | 1 | 0 |

These controls do not replace the provider-stack gate, but they falsify the
claim that removing retrieval exposure necessarily caused the observed
-1.4306pt result.

Raw reports:

- `attribution-controls/provider-free-c1-baseline.json`
  (`sha256:6815cd2a2c99a83f8f4e1159fd92b6fa671268ed56c4fd2c2b0643f881f69157`)
- `attribution-controls/provider-free-c1-candidate.json`
  (`sha256:2cd700a62ee4c26c0a492f209438f38b6ba1f5fac43dd792a0652185ec65936e`)
- `attribution-controls/provider-free-c40-baseline.json`
  (`sha256:dfcafb68d9704970d58441ba3aa645ce9711bb88d543727fa3149f87032905df`)
- `attribution-controls/provider-free-c40-candidate.json`
  (`sha256:6737fb373343a955f4cf95c29aebf0183dd3a3a710deffb70b28b3fc1b979ce2`)

### Fixed-retrieval answer and judge controls

Reanswering the exact formal baseline seed changed 105 of 233 generated answer
strings. Overall strict answer score moved from 0.6027838185 to 0.5993635930
(-0.3420pt), while category results moved by more than 1pt.

The official rescore remained 221/233 overall, but category correct counts
changed from `(temporal=61, open_domain=10, multi_hop=41, single_hop=109)` to
`(61, 11, 39, 110)`. Rejudging the *same original answer bytes* reproduced the
original overall and category counts exactly, with zero judge failures.
Therefore answer generation contributes material variance; the fixed-answer
judge did not in this control.

Raw reports:

- `attribution-controls/baseline-fixed-seed-answer-replicate.json`
  (`sha256:188b10ee850160d4b7a4e99318bd77900b4c85bdc3f38bef5c286643534ca0f9`)
- `attribution-controls/baseline-fixed-answer-judge-replicate.json`
  (`sha256:80f73b0e2e152fea84c0f8cc4388a5da4c0ce281f526ebd67988045ab35a4da7`)

## Conclusion

The first paired run is a valid blocked observation, but it is not a clean
causal estimate of the code change. Provider extraction/reranking variability
crossed the 1pt threshold at the same commit, and answer generation changed
more than forty percent of answers from the same retrieval seed.

Do not rerun until a replacement protection protocol is pre-registered. The
replacement must control provider variance (for example, frozen response
replay or an explicit replicated design) without deleting this failed run or
selecting only a favorable rerun. Until then:

- v0.7.3 publication is blocked;
- the full 1540-question claim chain must not run;
- no npm tag, GitHub release, or public score may be published.

The validator was also corrected after this run to accept the real recipe
shape: seed reports are `retrieval-only` with
`answerEvaluation=deferred-to-live-mode`; only reanswer reports are scored
`live-answer` reports. That correction changes the next candidate commit and
does not retroactively turn this blocked run into release evidence.
