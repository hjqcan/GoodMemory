# v0.7.3 schema-7 protection attempt: terminal ENOSPC

Status: blocked; not release evidence
Date: 2026-08-09
Baseline: `456edd106f29118b3455bf21c43d7b3107b48213`
Candidate: `c5665458f79adbc7d35eccb2155dc40b2a443ae2`

## Outcome

This was the single formal attempt authorized by the schema-7
preregistration. The driver matched the clean candidate commit, both
measurement checkouts were clean and detached, Bun was 1.3.14, and the LoCoMo
`cases.json` SHA-256 was
`e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28`.

All five provider-availability probes returned parse-valid HTTP 200 responses:
three production-shaped eval listwise requests, one embedding request, and one
official-compatible judge request. Only after those probes passed did the
runner create the immutable schema-7 consumed sentinel.

The deterministic protection layer was green:

- provider-free concurrency 1: zero execution failures, overall evidence
  recall `0.3022174535050071 -> 0.3108011444921316` (`+0.858369pt`);
- provider-free concurrency 40: zero execution failures, overall evidence
  recall `0.3022174535050071 -> 0.3065092989985693` (`+0.429185pt`);
- deterministic scenario replay passed `8/8` with zero failures.

Both provider discovery arms also completed all 233 questions with zero
execution or judge failures. Their discovery-only summaries were:

- evidence recall: `0.8163090128755365 -> 0.8163090128755365`;
- strict stored-answer score: `0.5965665236051502 -> 0.5879828326180258`;
- official gpt-5.5 stored-answer score:
  `0.9184549356223176 -> 0.9098712446351931` (`214/233 -> 212/233`).

Those numbers are diagnostics, not protection evidence. The runner had not yet
frozen the discovery response tape or executed the baseline/candidate formal
offline replay and paired sign test.

## Terminal failure

After candidate discovery and official rescore completed, the runner attempted
to atomically persist `provider-response-tape.json`. The Data volume had only
about 310 MiB available. The write failed before any bytes were persisted:

```text
ENOSPC: no space left on device, write
at writeAtomic (scripts/run-v0-7-3-replacement-protection-gate.ts:738)
at runGate (scripts/run-v0-7-3-replacement-protection-gate.ts:1927)
```

The retained `provider-response-tape.json.partial` is zero bytes. There is no
frozen tape, no formal replay, no compact passing artifact, and no valid paired
protection decision. The failure occurred after sentinel creation, so schema 7
is permanently consumed and is not rerun.

## Retained identities

- schema-7 consumed sentinel SHA-256:
  `9805fe3d671081b649c90e0b4935549142cdf3f493128cf7e73700f0e6fa01a9`;
- manifest SHA-256:
  `f8452119e50e55255ec15fcbb9f4b99eac467b23b1449bd50e7451f0e12d4472`;
- baseline discovery receipt SHA-256:
  `8ff16349ce4bc661a6157af96131b16fc43641bf6c6736a11b4419ff29592a81`;
- candidate discovery receipt SHA-256:
  `fc48c5373da7546be1a138d2169575c17f258a7a1b95f5989201dd8c8bd7bd7a`;
- baseline official summary SHA-256:
  `b65b3adfe21aa27f68a64365511820666a2176dcbf9306ecbc610c6071d17089`;
- candidate official summary SHA-256:
  `f813c8d829d66a83e71fbe1ccd68db1bec748f0ee47cec876919319ea6ba226c`.

## Decision

This attempt confirms that preflight, deterministic protection, scenario
replay, and both discovery arms executed successfully. It does not authorize a
v0.7.3 release. No full 1,540-question claim, tag, npm publish, or GitHub
Release follows from schema 7.

A later formal attempt requires a new preregistration, a new immutable attempt
sentinel, and a new clean candidate. That candidate must also repair the
tag-workflow shallow checkout discovered during this run; the current workflow
cannot satisfy readiness checks that inspect the measured candidate and
baseline history.
