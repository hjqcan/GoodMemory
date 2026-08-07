# v0.7.3 schema-3 protection attempt: blocked provider discovery

Status: blocked; not release evidence
Date: 2026-08-07
Baseline: `456edd106f29118b3455bf21c43d7b3107b48213`
Candidate: `113477d33888a37c40051c43c120af33d2adc312`

## Outcome

This was the single clean attempt authorized by the schema-3 preregistration.
Both measurement checkouts were clean and detached, Bun was 1.3.14, and the
LoCoMo `cases.json` SHA-256 was
`e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28`.

The deterministic protection layer was green:

- provider-free concurrency 1: zero execution failures, overall evidence
  recall `0.30221745350500717 -> 0.31080114449213164` (`+0.858369pt`);
- provider-free concurrency 40: zero execution failures, overall evidence
  recall `0.30221745350500717 -> 0.3065092989985694` (`+0.429185pt`);
- the minimum category, conversation, or overall delta in either pair was
  `0.000000pt`;
- deterministic scenario replay passed `8/8` with zero failures.

The provider diagnostic stopped during baseline discovery seed. The seed
process exited zero after materializing its report, but the runner rejected the
report because 152 of 233 questions had execution failures. All 152 failures
belonged to `locomo-conv-26`; the other 81 questions succeeded. Every failed row
recorded the same seed error:

```text
Structured model response was not valid JSON: SyntaxError: JSON Parse error: Expected ']'
```

The execution receipt recorded 228 provider requests: 3 tape hits, 225 misses,
225 live requests, zero coalescing, zero non-2xx responses, and zero sequence
mismatches. The target census was 104 embedding requests and 124 eval requests.
The runner then failed closed with `provider seed report is incomplete`; no
candidate discovery or formal replay ran.

## Evidence boundary

The HTTP response was successful, so this is not a transport or non-2xx
failure. The available evidence proves only that the model response presented
to the structured-output parser was invalid JSON. It does not uniquely prove
whether truncation originated in the model, gateway, or another upstream
serialization boundary.

The proxy held the successful response in memory, but this failure occurred
before the runner's union-tape write. Consequently the malformed response bytes
were not persisted. The archived extraction cache contains 36 successful
entries; the failed response is represented only by the parser error and the
receipt's hashed request sequence. A future protocol revision must persist a
failure tape snapshot before throwing if it wants byte-level attribution. That
revision would require a new preregistration and cannot authorize rerunning
this attempt.

The 26 archived files total about 1.8 MiB. A scan against the configured
provider credentials found no API-key value in the evidence tree. Key
identities are:

- manifest: `660ba2cea3e514cc6c8ee4930d2f9957d83606b328867c84ad572a9cd0157758`;
- baseline discovery receipt:
  `4be31f5ed41c395c851029520780df0ea9baf179a57719124ffcca1c2d7b5c38`;
- incomplete seed report:
  `0d8425e4f515616bbfe607511468985218b4b164b44f9d8013c44aac85486661`;
- extraction cache:
  `4f46c64281375c0a90e83b2b339b4cf203fab657a4467aae28d4212a6ff912af`.

## Consequence

This attempt does not show a lifecycle-code regression: the deterministic
instruments were neutral-to-positive. It also does not satisfy the provider
diagnostic, because any execution failure invalidates the run. There is no
schema-3 compact passing artifact, no full 1540-question claim rerun, no tag,
no npm publish, and no GitHub Release.
