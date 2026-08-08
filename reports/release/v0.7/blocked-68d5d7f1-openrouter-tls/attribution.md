# v0.7.3 schema-4 protection attempt: blocked provider discovery

Status: blocked; not release evidence
Date: 2026-08-07
Baseline: `456edd106f29118b3455bf21c43d7b3107b48213`
Candidate: `68d5d7f1705b410d3220e1782a446baa11fb80d5`

## Outcome

This was the single clean attempt authorized by the schema-4
preregistration. Both measurement checkouts were clean and detached, Bun was
1.3.14, and the LoCoMo `cases.json` SHA-256 was
`e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28`.

The deterministic protection layer was green:

- provider-free concurrency 1: zero execution failures, overall evidence
  recall `0.30221745350500717 -> 0.31080114449213164` (`+0.858369pt`);
- provider-free concurrency 40: zero execution failures, overall evidence
  recall `0.30221745350500717 -> 0.3065092989985694` (`+0.429185pt`);
- both overall movements remained inside the pre-registered 1.00pt hard
  boundary, and no deterministic regression was observed;
- deterministic scenario replay passed `8/8` with zero failures.

The provider diagnostic stopped during baseline discovery seed. The seed
process materialized a 233-question report and exited zero, but every question
carried an execution failure: 81 reported `Internal Server Error` and 152
reported `Malformed openai-compatible gateway response: expected choices array
or error object.` The runner therefore rejected the report as incomplete. No
candidate discovery, union-tape freeze, formal replay, provider comparison, or
paired sign test ran.

## Transport observation and attribution boundary

The parent gate terminal showed the loopback proxy's upstream fetch to
`https://openrouter.ai/api/v1/embeddings` aborting with
`UNKNOWN_CERTIFICATE_VERIFICATION_ERROR` and `unknown certificate verification
error`. That exception is not present in the stage child stderr, generated seed
report, or execution receipt; those retained only the downstream failure
messages and `provider seed report is incomplete` validation failure.

Consequently the archived files do not prove that one TLS exception uniquely
caused both downstream failure classes or all 233 question failures. The timing
and request census make a transient upstream transport failure the
best-supported operational explanation, not a uniquely proven root cause. A
post-failure read-only check at `2026-08-08T02:07:13Z` returned HTTP 200 for
`https://openrouter.ai/api/v1/models` from both Bun fetch and curl. That rules
out a persistent failure at the time of the check, but does not retroactively
turn the invalid attempt into a pass.

## Failure-tape result

Schema 4 did close the previous response-loss gap. Before throwing, the runner
waited for accepted in-flight proxy work and atomically persisted the current
successful-response snapshot. The receipt records 33 accepted requests, 3 tape
hits, 30 live requests, zero non-2xx responses, zero sequence mismatches, and a
target census of 5 embedding plus 28 eval requests.

The strict schema-2 failure tape contains 29 exact successful responses: 25
eval and 4 embedding entries, all status 200, with 44,798,817 raw response
bytes. The fifth live embedding request failed before a response existed, so
there is correctly no successful-response entry for it. Strict parsing,
response hashes, and a credential scan over plaintext plus decoded tape fields
passed. The receipt records zero credential-bearing entries excluded before
persistence.

The 59,751,522-byte raw JSON tape was stored losslessly as deterministic gzip
to keep the blocked archive reviewable in Git:

- raw JSON SHA-256:
  `f4c47e4aa458a1068412d19e201452e66a1e10c2aecc161c27fd72084d878372`;
- gzip bytes: `8,994,413`;
- gzip SHA-256:
  `a5029c74d6de99e2ab2bdff6419f7795d6b8b7eee6b7b9df17f4c20c9980d6bd`.

`failure-tape.compression.json` binds both identities. `gzip -t` passed, and
the following command reproduces the exact raw bytes:

```bash
gzip -cd failure-tape.json.gz > failure-tape.json
```

## Command and retained identities

The attempt used the single pre-registered command shape:

```bash
bun run gate:v0.7.3-lifecycle-protection -- \
  --baseline-worktree /private/tmp/goodmemory-v073-schema4.dJfd1w/baseline \
  --candidate-worktree /private/tmp/goodmemory-v073-schema4.dJfd1w/candidate \
  --benchmark-root /Users/hjqcan/.cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1 \
  --output-dir reports/release/v0.7/v0.7.3-lifecycle-evidence
```

Key retained identities are:

- manifest:
  `f287002fb461d8266a187d5f1e7081d78e0f02dc54c37e7e2962288aab9c7f68`;
- baseline-discovery receipt:
  `976f94af5b808d6167b130206ca1d3e41093259c413703a05cbd53e12fd67532`;
- incomplete seed report:
  `df23ccee3afd645265ed3c6fced6138893654736024dd3539d28fc1eb7121d03`;
- compressed failure tape:
  `a5029c74d6de99e2ab2bdff6419f7795d6b8b7eee6b7b9df17f4c20c9980d6bd`.

## Decision

This attempt supports the narrow conclusion that the lifecycle code change did
not cause a deterministic regression on the protected slice. It does not
satisfy the provider diagnostic. There is no schema-4 compact passing artifact,
no full 1,540-question claim rerun, no tag, no npm publish, and no GitHub
Release.

Schema 4 is not rerun. Any new live attempt requires a new preregistration that
persists a sanitized transport-attempt/error ledger before stage failure and
explicitly freezes whether transport errors receive bounded retries. Those
changes must be implemented and verified before another measurement begins.
