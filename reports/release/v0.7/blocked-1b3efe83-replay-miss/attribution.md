# v0.7.3 replacement protection: blocked on formal replay instability

Status: invalid protection run; release remains blocked
Measured candidate: `1b3efe83153b6ce7a3a49674dadda26f3d338eca`
Baseline: `456edd106f29118b3455bf21c43d7b3107b48213`
Date: 2026-08-07

This directory is not passing release evidence. The deterministic hard-gate
inputs completed, and provider discovery completed, but the formal baseline
run could not replay the frozen provider tape without request misses. No
compact lifecycle-protection artifact was produced.

## Deterministic hard gate

- Scenario replay: 8 passed, 0 failed.
- Provider-free c1 overall evidence recall: 30.2217% baseline to 31.0801%
  candidate, a +0.8584pt movement.
- Provider-free c40 overall evidence recall: 30.2217% baseline to 30.6509%
  candidate, a +0.4292pt movement.
- No category or conversation regressed. The largest absolute movement was a
  +1.5873pt temporal gain at c1, which requires a research record but is not a
  release blocker under the preregistered rule.

These results support the narrower conclusion that the lifecycle code change
did not cause a deterministic retrieval regression on the protected slice.
They do not substitute for a valid formal provider replay.

## Provider discovery

Both discovery arms completed seed, reanswer, and official rescore with zero
execution or judge failures.

- Baseline discovery: 1,015 requests, all live misses.
- Candidate discovery: 1,012 requests, 906 tape hits and 106 live misses.
- Official score: 213/233 (0.914163) in both discovery arms.
- Frozen union tape: 1,118 entries: 275 embedding, 598 eval, and 245 judge.
- Tape SHA-256: `d2d2323f4a7f1de4aae86c29931edd14f70cd53b431ece520829d8e7a6d0635d`.

The 154,361,742-byte raw tape is intentionally outside Git because it exceeds
GitHub's single-file limit and contains raw provider responses. The local
audit copy is:

`/Users/hjqcan/.cache/goodmemory-release-evidence/blocked-1b3efe83-replay-miss/provider-response-tape.json`

## Formal replay failure

The formal baseline seed produced local 502 responses for unrecorded request
fingerprints. These were tape-miss responses, not upstream provider 502s. The
reranker correctly fell back, but that fallback changed the measured request
stream and therefore cannot be accepted as a byte-identical replay.

The run was stopped before reanswer and judge work because the all-hit
condition had already failed. Of the 214 question rows written before the
stop, compared with baseline discovery:

- 40 had a different retrieved-turn set;
- 5 had different evidence recall;
- 28 had a different noise count.

The 38 assisted-extraction cache keys and their candidate payloads were
identical after sorting by key; both canonicalized caches hash to
`bcd567fb051c4bb75e45d442c8278958faabe516611288a660d95dc08942ba91`.
Their raw append order differed. This localizes the instability after
extraction, in the concurrent ingest/retrieval/request-construction path. It
does not yet prove which combination of completion order, reference time,
tie-breaking, or other runtime state changes the reranker request bodies.

Because the formal population was incomplete, no paired sign test or provider
point comparison is valid for this attempt.

## Process record

Two earlier invalid attempts were not promoted as evidence:

1. The first runner omitted the four claim categories and selected 304 rather
   than 233 questions. A failing test reproduced the defect before the runner
   was fixed.
2. The next provider seed received one malformed assisted-extractor response,
   marking all 152 conv-26 questions as execution failures. It was stopped
   before downstream answer and judge calls.

The runner now fails immediately after an invalid seed and stops after the
first stage command that observes a formal tape miss. Those hardenings landed
after this measured candidate; they do not convert this blocked run into a
pass.

## Decision

- Keep v0.7.3 unpublished.
- Do not run or publish the 1,540-question claim from this candidate.
- Do not reuse this tape as passing evidence.
- Pre-register a replacement that makes provider request construction stable
  before response replay, then run one new clean paired attempt. A likely
  direction is a frozen provider-input manifest plus deterministic ingest and
  retrieval ordering. Do not obtain hits by stripping semantically meaningful
  request fields from the fingerprint.

## Follow-up correction and schema-3 boundary

Later read-only comparison refined the 40 retrieval differences above: all 40
ordered `retrievedTurnIds` arrays differed, but 38 had different sets and two
had the same set in a different order. In addition, 210 of the 214 completed
rows occupied a different completion-order position from discovery.

The best-supported mechanism is v0.7.2 recall reinforcement interacting with
concurrency-40 completion order, then changing later candidate membership or
order and listwise reranker request fingerprints. The archived schema-2 tape
did not retain request bodies or a mismatch ledger, so this is not claimed as
the uniquely proven cause.

The replacement protocol is now schema 3: provider-free C1/C40 and scenario
replay remain the deterministic hard gate; the provider diagnostic runs at
concurrency 1, freezes each discovery arm's ordered provider-input identities,
and rejects any formal sequence mismatch before returning a cached response.
This is a new pre-registered diagnostic, not a provider-stack concurrency-40
measurement. It has not yet produced a passing run and does not change this
directory's blocked status.
