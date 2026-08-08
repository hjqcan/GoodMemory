# v0.7.3 schema-6 protection attempt: blocked provider auth availability

Status: blocked; not release evidence
Date: 2026-08-08
Baseline: `456edd106f29118b3455bf21c43d7b3107b48213`
Candidate: `4d5e29899617c40abf1a98bdc3598fe161887703`

## Outcome

This was the single clean attempt authorized by the schema-6
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

Baseline provider discovery completed its seed command and materialized all
233 question rows with zero seed execution failures. Its overall evidence
recall was `0.8266809728183117`. That report is not valid release evidence:
the provider ledger retained unrecovered HTTP 503 responses from the reranking
path even though the production runner fell back to deterministic ordering.
The upstream response classified the server-side condition as
`auth_unavailable` for provider `codex` and model `gpt-5.6-terra`.

Schema 6 correctly rejected the hidden fallback with:

```text
provider failure was not recovered by an immediate same-request retry
```

No candidate discovery, union-tape freeze, formal replay, reanswer, official
rescore, provider comparison, paired sign test, or full 1,540-question claim
ran.

## Ordered response and transport result

The discovery session recorded 555 application requests and exactly 555
upstream attempts, with zero proxy retries, zero coalescing, zero tape hits,
and zero sequence mismatches. The request census was 275 embedding plus 280
eval-routed requests.

The strict schema-3 occurrence tape contains:

- 543 HTTP 200 responses;
- 10 HTTP 503 responses;
- 2 sanitized transport failures represented as synthetic HTTP 502;
- 112,819,420 decoded response-body bytes.

Both synthetic 502 occurrences were recovered by an immediate same-fingerprint
retry. One 503 occurrence was also recovered. Nine 503 occurrences across
three fingerprints formed terminal three-attempt chains with no following
HTTP 2xx response. Those terminal chains are the independent gate blocker.
The session transport-attempt ledger SHA-256 is
`62bc0c2f586d0337f819430a75e5c6847190e5484166508786ab2c3cd98176b8`.

The complete evidence directory was scanned for credential-like `sk-...`
material after the run and none was found. The receipt also records zero tape
entries excluded for credential material. Provider logs were retained only
after whole-buffer redaction.

## Failure-tape compression and retained identities

The 150,815,462-byte raw schema-3 JSON tape was stored losslessly as
deterministic gzip:

- raw JSON SHA-256:
  `2e983b0dafba3ca474e31718abd3c797a9624016785407b11bf261179410877a`;
- gzip bytes: `24,709,076`;
- gzip SHA-256:
  `5f13e678b67ba9a01da6e26f4c2a6a8b4893f71c561611b352e95d379c53c941`.

`gzip -t` passed, and `gzip -cd` reproduced the original byte count and
SHA-256. Other retained identities are:

- manifest:
  `3b2b7bcd29718015695706ce93178cdb49139f8977ff67ea86859abe12dd249f`;
- baseline-discovery receipt:
  `501f40455d5ee8fcb65469e904587f860500b795e13da4e47a2ed3d8d48231a8`;
- complete seed report:
  `f25633f0be299a1469527ba237ba4c608498edbe88b4a09784584834306cb937`;
- redacted stderr:
  `b252011d61be2f632e32d923c7080b08034b23f21947259cda2e25de7a829202`.

## Decision

This attempt supports the narrow conclusion that the lifecycle change did not
cause a deterministic regression on the protected slice. It does not satisfy
the provider diagnostic. There is no schema-6 compact passing artifact, no
full 1,540-question claim rerun, no `v0.7.3` tag, no npm publish, and no GitHub
Release.

Schema 6 is not rerun. Any later live attempt requires a new preregistration
and verifier revision that states how provider-side model availability is
established before consuming the sole formal attempt. This blocked archive is
the terminal evidence for the only schema-6 attempt.
