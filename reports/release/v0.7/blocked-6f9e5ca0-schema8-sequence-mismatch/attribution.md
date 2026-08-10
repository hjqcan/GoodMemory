# v0.7.3 schema-8 protection attempt: terminal replay sequence mismatch

Status: blocked; not release evidence
Date: 2026-08-10
Baseline: `456edd106f29118b3455bf21c43d7b3107b48213`
Candidate: `6f9e5ca03112143fb06cd58049ceb4910367b282`

## Outcome

This was the single formal attempt authorized by the schema-8
preregistration. The driver and detached candidate checkout matched the clean
candidate commit, the detached baseline checkout matched the frozen v0.7.2
baseline, Bun was 1.3.14, and the LoCoMo `cases.json` SHA-256 was
`e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28`.

The storage qualification observed `10,252,374,016` available bytes against
the fixed `4,294,967,296`-byte minimum. All five provider-availability probes
returned parse-valid HTTP 200 responses. Only after both qualifications passed
did the runner create the immutable schema-8 consumed sentinel.

The deterministic protection layer was green:

- provider-free concurrency 1: zero execution failures, overall evidence
  recall `0.30221745350500717 -> 0.31080114449213164` (`+0.858369pt`);
- provider-free concurrency 40: zero execution failures, overall evidence
  recall `0.30221745350500717 -> 0.3065092989985694` (`+0.429185pt`);
- deterministic scenario replay passed `8/8` with zero failures.

Both provider discovery arms completed all 233 questions with zero execution
or judge failures. Their discovery-only summaries were:

- evidence recall: `0.8041487839771102 -> 0.8116595135908441`
  (`+0.751073pt`);
- strict stored-answer score: `0.6051502145922747 -> 0.6137339055793991`
  (`+0.858369pt`);
- official gpt-5.5 stored-answer score:
  `0.9184549356223176 -> 0.927038626609442`
  (`214/233 -> 216/233`, `+0.858369pt`).

Those numbers are diagnostics, not protection evidence. The union response
tape was successfully persisted as ten bounded gzip parts. Its canonical tape
contains 1,147 entries and 155,540,308 raw JSON bytes.

## Terminal failure

The baseline formal frozen replay completed its 233-question seed process, but
the replay proxy rejected 76 eval requests because their canonical request
bodies did not match the preregistered baseline discovery input sequence:

```text
baseline-formal formal provider replay observed 76 input sequence mismatch(es)
```

The formal session recorded 556 requests, 480 exact tape hits, zero misses,
zero live requests, zero upstream transport attempts, and 76 sequence
mismatches. Every mismatch retained the expected target, method, path, and
semantic headers (`eval`, `POST`, `/chat/completions`); only the canonical body
hash and full request fingerprint changed. None of the 76 actual fingerprints
exists anywhere in the complete discovery multiset, so this is not an ordering
or occurrence-counter problem and cannot be repaired by weakening the verifier
to compare multisets.

The proxy returned deliberate HTTP 409 responses for those mismatches. The
product reranker then followed its normal provider-error fallback and preserved
deterministic recall. Exactly 76 of 233 retrieved-turn sets differed between
baseline discovery and baseline formal replay, and formal evidence recall fell
from `0.8041487839771102` to `0.7698140200286123`. The runner correctly rejected
the stage rather than accepting fallback output. Candidate formal replay and
the paired analyzer did not run. No passing compact artifact exists.

## Attribution boundary

The retained request evidence binds hashes rather than raw request bodies, so
it proves request-body drift but cannot by itself name the exact drifting JSON
field. It does expose one concrete deterministic identity leak that a successor
protocol must close and reproduce locally before another live attempt:

- `buildV073StageArm` derives the seed run ID from the stage name, so discovery
  and formal replay use different seed run IDs;
- the LoCoMo runner feeds that run ID into `buildLocomoScope`, where it becomes
  `workspaceId`;
- recall projection entity IDs are stable hashes of `scopeKey` plus canonical
  entity key, so the same memory content receives different projection IDs
  across discovery and formal stages;
- generalized fusion uses those projection IDs in deterministic ordering and
  rerank-pool construction, which can change the listwise reranker request body
  even though extractor cache bytes are identical.

The discovery and formal extraction caches are byte-identical: 38 rows,
392,464 bytes, SHA-256
`8eb064b493d10abe0db391300fa07c33cd742a3baf1afbfc53de70ac6af49206`.
A pure local check also confirms that the two retained seed run IDs produce
different recall scope keys and different entity projection IDs for the same
canonical entity. This is a measurement-harness identity problem, not evidence
that the lifecycle patch regressed retrieval. A successor schema must add a
provider-free request-capture regression proving that a shared semantic seed
identity makes discovery and formal request sequences byte-identical. Exact
fingerprint matching remains the gate; no fuzzy canonicalization is authorized
by this attribution.

## Retained identities

- schema-8 consumed sentinel SHA-256:
  `9a0461e3ab626b72a47bbbe060c290c27429d867672aa7488dfa6001713ef91b`;
- manifest SHA-256:
  `ba6744cb92d82d19120db3a64d058d136d7f1a93f5edcb2271e6369440e21773`;
- baseline discovery receipt SHA-256:
  `ce4b92050465c9b64a029d5499b5445c44bffa57653cf74d5ba45ceb5306c90d`;
- candidate discovery receipt SHA-256:
  `ee876b117001ef4eb67c926ae9f3663af0a761f7c6daf6054aa365e1ded99a33`;
- baseline formal failure receipt SHA-256:
  `2dfdb150d87cd2170a9c3953df50dfc25de955cfba356b12af3908fa63000f5e`;
- response-tape manifest SHA-256:
  `4f4077810011f266f62f7969324cf8e3977268a3fb4ba370b0f2381ec0449dc4`;
- baseline official summary SHA-256:
  `456e9fa5367d8866813e9e425b863d535a029fd9d05d0b64dea6dc473fc35216`;
- candidate official summary SHA-256:
  `fe769cd021ab21cb3ad9d5fb882e5eb8b3aa744491e54d317239147b23d9f090`.

## Decision

Schema 8 is permanently consumed and is not rerun. It does not authorize a
v0.7.3 release. No full 1,540-question claim, tag, npm publish, or GitHub
Release follows from this attempt.

A later formal attempt requires a new preregistration, schema number, immutable
sentinel, evidence root, verifier revision, local request-stability regression,
and clean candidate commit. The archived discovery metrics remain diagnostics
only and cannot be promoted by a successor schema.
