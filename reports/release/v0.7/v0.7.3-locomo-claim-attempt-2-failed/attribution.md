# v0.7.3 full LoCoMO claim attempt 2 — terminal invalid

Status: terminal invalid; release blocked; no third draw is authorized.

This was the single fresh replacement draw pre-registered after attempt 1
failed. It ran from the same measured candidate
`21dcac8d10b0b6714d09cf14eacd83e32e0c9513` with Bun 1.3.14, the frozen
full-10 LoCoMo root, the recorded v0.7.3 provider identities, concurrency 40,
and the canonical `scripts/run-v0-7-3-full-locomo-claim.ts` launcher. It used
new clean detached candidate and evidence worktrees and did not reuse attempt
1 checkpoints, extraction cache, reports, or responses.

The seed report completed all 1,540 rows but contained 178 execution failures.
The launcher therefore stopped before re-answer, official judging, claim
projection, or tracked claim-evidence publication. The candidate and evidence
checkouts both remained clean at the measured candidate commit; the final run,
official run, claim-evidence directory, and v0.7.3 claim projection were never
created.

## Attribution

- All 178 failed rows belong to `locomo-conv-43`; the other nine
  conversations have zero execution failures.
- Every failed row has `executionFailureStage="seed"` and the same sanitized
  message: `OpenAI-compatible gateway timeout after 120000ms.`
- The conversational-extraction cache contains 271 of the frozen 272 sessions.
  Recomputing the production cache keys identifies the only missing entry as
  `locomo-conv-43/D27`.
- `locomo-conv-43/D27` contains 40 turns. Its canonical extraction-message
  input is 7,666 bytes, the second largest of the 272 frozen sessions. This
  establishes that the terminal request was another long-input tail, but the
  retained artifacts do not contain a per-attempt transport ledger and cannot
  distinguish transient gateway/provider latency from input-specific slow
  generation more precisely.
- One conversational-extraction rejection is caught at the case seed boundary,
  which expands it into all 178 questions for that conversation. The report is
  not evidence of 178 independent provider failures.
- The failure location differs from attempt 1: `locomo-conv-48` completed
  191/191 rows with zero failures in this replacement. Attempt 2 therefore did
  not reproduce the first request failure, but it encountered the same class of
  terminal extraction timeout in a different long session.
- The two cache files share 270 exact keys. `locomo-conv-43/D27` is present in
  attempt 1 and missing only here, while attempt 1's missing
  `locomo-conv-48/D15` is present here. Both terminal inputs therefore succeeded
  in the other fresh draw. This rules out an always-failing cache key or
  deterministic per-session rejection, but it still does not identify the
  transport or provider mechanism behind the long-tail timeouts.

The raw failed report, successful-question checkpoint, and extraction cache are
retained byte-for-byte in this directory. Their identities are:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `smoke-report.json` | 1,604,427 | `5d207a5f10abcaacc4384f983783c92c1c7a60111c7d8ae4e22fa6a127626100` |
| `live-progress.jsonl` | 930,597 | `ce4152a72d4acf76984103dab0fa31fbf0589b395803c9be4bb6277d22d190b1` |
| `extraction-cache.jsonl` | 2,673,072 | `805ce390583c878ab6066eb0d7c718fae00b2b070b333140c037df64a0475102` |

The report was generated at `2026-08-10T15:44:55.644Z`, has benchmark
fingerprint `240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd`,
and records `executionFailures=178`. Exact configured-secret and generic
credential-pattern scans over all three retained files returned zero hits.
The benchmark-derived rows remain within the report's recorded `CC BY-NC 4.0`
non-commercial evaluation boundary.

## Terminal release decision

Attempt 1's pre-registration authorized exactly this one fresh replacement and
stated that any execution or judge failure would block release without
authorizing a third draw. That condition occurred. The following are therefore
not valid continuations of the v0.7.3 release chain:

- resuming this seed checkpoint or extraction cache;
- running re-answer or official judging directly against this failed report;
- deleting or overwriting either failed output namespace;
- changing output or run IDs to start another live draw;
- changing timeouts, retries, concurrency, routing, prompts, model identity, or
  the claim recipe while treating the result as the measured candidate's
  release claim.

The fixed terminal replacement identities were:

- output root: `reports/eval/research/v073-21dcac8d-full1540-replacement-1`
- seed run: `v073-21dcac8d-full1540-replacement-1-seed`
- final run: `v073-21dcac8d-full1540-replacement-1-final` (not created)
- official run: `v073-21dcac8d-full1540-replacement-1-official-gpt55`
  (not created)

Schema 9 lifecycle protection remains a passing code-change measurement, but
it is not a release authorization in the absence of a valid full claim chain.
GoodMemory v0.7.3 remains unpublished; npm `latest`, the public GitHub Release,
and the stable tag remain at v0.7.2.
