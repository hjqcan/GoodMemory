# v0.7.3 full LoCoMo claim attempt 1 — terminal invalid

Status: terminal invalid; no release authorization.

This was the first fresh full-1540 claim draw after the passing Schema 9
lifecycle protection gate. It ran from the measured candidate
`21dcac8d10b0b6714d09cf14eacd83e32e0c9513` with Bun 1.3.14, the frozen
full-10 LoCoMo root, the recorded v0.7.3 provider identities, concurrency 40,
and the canonical `scripts/run-v0-7-3-full-locomo-claim.ts` launcher.

The seed report completed all 1,540 rows but contained 191 execution failures,
so the launcher correctly stopped before re-answer, official judging, claim
projection, or tracked claim-evidence publication. `main` and the dedicated
evidence checkout remained clean.

## Attribution

- All 191 failed rows belong to `locomo-conv-48`; the other nine
  conversations have zero execution failures.
- Every failed row has `executionFailureStage="seed"` and the same sanitized
  message: `OpenAI-compatible gateway timeout after 120000ms.`
- The conversational-extraction cache contains 271 of the frozen 272 sessions.
  The only missing cache entry is `locomo-conv-48/D15`.
- The failure therefore represents one conversational-extraction request that
  exhausted its retry budget, amplified by the case-level seed failure boundary
  into all 191 pending questions for that conversation. It is not evidence of
  191 independent provider failures.
- Successful work before and after `locomo-conv-48` rules out a run-wide
  outage. The retained artifacts do not contain a per-attempt transport ledger,
  so they cannot distinguish a transient network/provider tail from
  input-specific slow generation more precisely.

The raw failed report, successful-question checkpoint, and extraction cache are
retained byte-for-byte in this directory. Their identities are:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `smoke-report.json` | 1,602,490 | `4a958523a3f598417aee1320d3fdbb0daffa3ff8c0e487b161d6632843eed320` |
| `live-progress.jsonl` | 924,795 | `6ada0501b8d751dec885a318b26b66b0e3076ac19940540704796fbbeaa9c0c1` |
| `extraction-cache.jsonl` | 2,633,596 | `391ae8872fac131fb5e14ddf45dc1f3633ba57d20ae49f7a3e136702c4e63889` |

The report was generated at `2026-08-10T14:27:23.606Z`, has benchmark
fingerprint `240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd`,
and records `executionFailures=191`. Exact configured-secret and generic
credential-pattern scans over all three retained files returned zero hits.

## Pre-registered replacement draw

One replacement draw is authorized because attempt 1 is an infrastructure-
invalid claim run, not a scored claim result. It must satisfy all of the
following before any provider request:

- use two new, independent, clean detached worktrees at the same measured
  candidate `21dcac8d10b0b6714d09cf14eacd83e32e0c9513`;
- use the same benchmark bytes, Bun version, provider identities, prompt and
  command construction, question order, concurrency, timeout, and retry policy;
- use the canonical full-claim launcher with a new output namespace and three
  new run IDs;
- start fresh: do not copy or reuse attempt 1 checkpoints, extraction cache,
  reports, or responses;
- retain attempt 1 permanently and never overwrite or reclassify it;
- require zero execution failures and zero judge failures; any such failure in
  the replacement draw blocks release and does not authorize a third draw.

The fixed replacement identities are:

- output root: `reports/eval/research/v073-21dcac8d-full1540-replacement-1`
- seed run: `v073-21dcac8d-full1540-replacement-1-seed`
- final run: `v073-21dcac8d-full1540-replacement-1-final`
- official run: `v073-21dcac8d-full1540-replacement-1-official-gpt55`

This replacement changes no product code, measurement code, provider identity,
or acceptance threshold. A successful replacement is still only the fresh
claim input; stable promotion, final strict readiness, tag, npm publication,
GitHub Release creation, and public destination verification remain separate.
