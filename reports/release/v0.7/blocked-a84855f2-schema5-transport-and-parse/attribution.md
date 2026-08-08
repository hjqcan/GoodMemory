# v0.7.3 schema-5 protection attempt: blocked transport errors and parse failure

Status: blocked; not release evidence
Date: 2026-08-08
Baseline: `456edd106f29118b3455bf21c43d7b3107b48213`
Candidate: `a84855f2de8113df8a4a5e6c6f1171b3ab28f7b3`

## Outcome

This was the single clean attempt authorized by the schema-5
preregistration. Both measurement checkouts were clean and detached, Bun was
1.3.14, and the LoCoMo `cases.json` SHA-256 was
`e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28`.

The deterministic protection layer was green:

- provider-free concurrency 1: zero execution failures, overall evidence
  recall `0.30221745350500717 -> 0.31080114449213164` (`+0.858369pt`);
- provider-free concurrency 40: zero execution failures, overall evidence
  recall `0.30221745350500717 -> 0.3065092989985694` (`+0.429185pt`);
- neither arm regressed beyond the pre-registered 1.00pt hard boundary;
- deterministic scenario replay passed `8/8` with zero failures.

Baseline provider discovery did not pass. Only `seedSmoke` ran. It exited zero
and materialized all 233 question rows, but 81 rows had a seed execution
failure. All 81 belong to the second conversation and report the same
structured-output error:

```text
Structured model response was not valid JSON: SyntaxError: JSON Parse error: Expected ']'
```

That incomplete seed report independently invalidates the stage. The runner
also observed two upstream transport errors, which independently invalidate
schema-5 discovery even though existing downstream retries recovered. No
candidate discovery, union-tape freeze, formal replay, reanswer, official
rescore, provider comparison, or paired sign test ran.

## Transport ledger result

The stage receipt records 355 application requests: 3 tape hits and 352 live
misses. The proxy made exactly 352 upstream attempts and performed zero
retries of its own. It observed zero HTTP non-2xx responses and two transport
errors. The request census was 175 embedding plus 180 eval requests.

Both errors were sanitized as `connection` / `AbortError`, with no persisted
error code and the same error-message SHA-256
`ce3b0bf3cfbfae74f0e37738959a0ffca22be651c63f800ffc1a670a36a7cb6a`:

- request index 4, eval fingerprint
  `f0889dacfeb718bc33b4f934c84963604e29c1dc750f52060da27239adeafc13`;
- request index 9, eval fingerprint
  `f8c88f5f2dc7d06a2d61c56281b7de114ce0755ed0d0cf7325ba02556666d5fc`.

In both cases the next application request repeated the same fingerprint and
received HTTP 200. This proves that the existing downstream retry path
recovered both transport errors. It does not turn the attempt into a pass:
schema 5 pre-registered `transportErrors = invalidate-discovery` specifically
to prevent recovered provider instability from disappearing from the gate.

The 352-entry ledger has unique, strictly increasing request indices. Its
independently recomputed SHA-256 matches the receipt:

`e0990a380524fa16fe424cc0f13bcda064140f18a4b92426172b056e3c52fe09`.

The transport errors are not claimed to have caused the 81 structured-output
failures. The retry receipts show recovery, while the seed report establishes
a separate parse failure. These are two independent invalidators, not one
causal story.

## Failure-tape result

Before throwing, the runner waited for accepted in-flight work and atomically
persisted the successful-response snapshot. The strict schema-2 failure tape
contains 350 exact HTTP 200 responses: 175 embedding and 175 eval entries,
with 79,708,409 decoded response-body bytes. The two transport failures have
no response entry, as required.

Strict parsing, response hashes, ledger re-hashing, and a credential scan over
the complete evidence directory passed. The receipt records zero
credential-bearing entries excluded before persistence, and the independent
scan found no configured credential material.

The 106,515,439-byte raw JSON tape was stored losslessly as deterministic gzip:

- raw JSON SHA-256:
  `447ec785e979e3d2740d7a30fb9ba46bcc12f858b3dbbbd5aba56f72c901a69a`;
- gzip bytes: `18,272,761`;
- gzip SHA-256:
  `d9568dfb25fe714cfe5411b718401c42d737acea4de857f9eda9a88eba7efba2`.

`failure-tape.compression.json` binds both identities. `gzip -t` passed, and
`gzip -cd` reproduced the original byte count and SHA-256.

## Command and retained identities

The attempt used the pre-registered command shape with no branch creation:

```bash
bun run gate:v0.7.3-lifecycle-protection -- \
  --baseline-worktree /private/tmp/goodmemory-v073-schema5.3dMep8/baseline \
  --candidate-worktree /private/tmp/goodmemory-v073-schema5.3dMep8/candidate \
  --benchmark-root /Users/hjqcan/.cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1 \
  --output-dir reports/release/v0.7/v0.7.3-lifecycle-evidence
```

Key retained identities are:

- manifest:
  `2cc18d5db93ddbcba02dde726d002e4f02a0a1f809b937e1c41db95783e45cb7`;
- baseline-discovery receipt:
  `bd7e395ae812543b4e81347116a000e1fc9535e43dc443d0a2d7d0cfc7adaacd`;
- incomplete seed report:
  `7f7d0648aad1f61bf1fa11926a7504b1fa03698e4af065a348b7366042053e69`;
- compressed failure tape:
  `d9568dfb25fe714cfe5411b718401c42d737acea4de857f9eda9a88eba7efba2`.

## Decision

This attempt supports the narrow conclusion that the lifecycle change did not
cause a deterministic regression on the protected slice. It does not satisfy
the provider diagnostic. There is no schema-5 compact passing artifact, no
full 1,540-question claim rerun, no `v0.7.3` tag, no npm publish, and no GitHub
Release.

Schema 5 is not rerun. Any later live attempt requires a new preregistration
and verifier revision. This blocked archive is the terminal evidence for the
only schema-5 attempt.
