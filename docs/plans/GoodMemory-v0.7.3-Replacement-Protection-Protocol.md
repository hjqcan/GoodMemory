# GoodMemory v0.7.3 Replacement Protection Protocol

Status: the single schema-6 attempt is blocked and archived; it will not be
rerun. There is still no passing run or release
Date: 2026-08-08
Baseline: `456edd106f29118b3455bf21c43d7b3107b48213` (`v0.7.2^{}`)

## Why the first gate remains blocked

The first 233-question provider-backed pair remains a valid blocked observation,
not release evidence. Its overall movements were -1.4306pt evidence recall,
-2.4976pt strict answer score, and -2.1459pt official score. Attribution then
showed a -1.8026pt same-commit provider retrieval replicate, 227/233 changed
retrieved sets, and 105/233 changed answer strings from fixed retrieval.

The old 11-improved / 15-regressed official-correctness split has an exact
two-sided paired sign-test result of `p=0.5571970939636236`. It is not
statistically significant at the pre-registered `alpha=0.05`. This does not
retroactively pass the old gate: the original point-threshold rule correctly
blocked, and its evidence under
`reports/release/v0.7/blocked-6eb0f87d/` remains byte-for-byte historical.

The first schema-2 response-tape attempt is also permanently blocked. Its
provider-free c1/c40 and scenario layers passed, but the formal baseline replay
missed request fingerprints. Of the 214 formal rows written before the stop,
210 occupied a different completion-order position than discovery. Forty
ordered retrieved-turn arrays differed: 38 had different sets and two differed
only in order. The assisted-extraction candidates were byte-equivalent after
canonical ordering.

The best-supported mechanism is that v0.7.2 writes access state after recall
while 40 questions run concurrently, so live completion order can decide which
recalls first reinforce shared facts. A different completion order can then
change later rankings and reranker request bodies. The archived schema-2 tape
did not retain request bodies or a mismatch ledger, so this is not claimed as
the uniquely proven cause. Replaying concurrency 40 while preserving the
baseline's shared-state semantics would require either reproducing the relevant
completion schedule or introducing a more invasive deterministic observation
barrier. Neither is necessary for this protection decision. Schema 2 is not
accepted as release evidence even if a later run happens to avoid misses.

## First schema-3 execution remains blocked

The single clean schema-3 attempt at candidate `113477d3` passed the
deterministic boundary: provider-free C1 moved overall evidence recall by
`+0.858369pt`, C40 moved it by `+0.429185pt`, no category or conversation
regressed, and scenario replay passed 8/8. These results do not substitute for
the provider diagnostic.

Baseline discovery then produced one successful HTTP response that was invalid
structured JSON. The seed report contained 152 execution failures and the
runner stopped before candidate discovery or either formal arm. The receipt
recorded zero non-2xx responses and zero sequence mismatches, so the evidence
supports a structured-output parse failure, not a transport failure. The raw
malformed response was not persisted because the run stopped before the union
tape write; its exact upstream cause is therefore not uniquely attributable.

The incomplete evidence and attribution are archived under
`reports/release/v0.7/blocked-113477d3-provider-json/`. This execution does not
authorize another attempt. Persisting a failure tape snapshot or adding an
assisted-extraction timeout changes the evidence protocol and requires a new
preregistration first.

## Schema-4 revision

Schema 4 changes evidence capture, not either measured arm:

- the existing LoCoMo harness remains byte-identical in baseline and candidate;
- assisted extraction keeps its existing per-attempt timeout of `120000ms` and
  its existing maximum of four attempts. Both values are now explicit in the
  manifest and independently checked. This is a per-attempt bound, not a new
  whole-run deadline;
- if a discovery stage is going to fail because a command exited non-zero, a
  seed report is incomplete, an intermediate provider check fails, or final
  output validation fails, the runner first waits for any accepted in-flight
  proxy request to settle under the existing request timeout, serializes the
  current successful-response snapshot, atomically writes
  `failure-tape.json`, binds its byte count and SHA-256 in the stage receipt,
  and only then throws;
- the failure tape uses the strict schema-2 tape parser. It contains exact 2xx
  response bytes and hash-only request identities for credential-free entries,
  never raw request bodies or credential-bearing headers. An entry whose path,
  response metadata, or response body contains a configured provider
  credential is excluded before persistence; the exclusion count is recorded
  in the secret-free receipt. The tape is attribution evidence only and can
  never make an incomplete stage pass.

No schema-4 attempt may begin until the implementation, focused regressions,
full tests, typecheck, coverage, and readiness verifier are green on one frozen
`main` commit. A failed attempt is archived once; it is not retried until the
cause is attributed and a new protocol revision is pre-registered.

## First schema-4 execution is blocked

The single clean schema-4 attempt at candidate `68d5d7f1` again passed the
deterministic boundary: provider-free C1 moved overall evidence recall by
`+0.858369pt`, C40 moved it by `+0.429185pt`, and scenario replay passed 8/8.
Baseline provider discovery then materialized a 233-question seed report with
233 execution failures, so the runner stopped before candidate discovery or
formal replay.

The parent gate terminal observed an OpenRouter embedding fetch fail with
`UNKNOWN_CERTIFICATE_VERIFICATION_ERROR`. The failure occurred after 29 exact
successful 2xx responses had been recorded. Schema 4 atomically persisted
those responses in a strict failure tape before aborting, so its intended
response-preservation fix worked. However, the transport exception itself did
not enter the stage receipt or child logs. It is therefore the best-supported
operational explanation, not a uniquely proven root cause for every downstream
failure.

The incomplete evidence, compressed lossless failure tape, and attribution are
archived under
`reports/release/v0.7/blocked-68d5d7f1-openrouter-tls/`. A later Bun and curl
probe both returned HTTP 200, which is consistent with a transient failure but
does not validate this attempt. Schema 4 is not rerun. Any later attempt needs
a new preregistration that binds transport-attempt/error capture and an
explicit retry policy before execution.

## Schema-5 revision

Schema 5 changes only discovery transport observation. It does
not change either commit under measurement, the deterministic arms, provider
models, prompts, request fingerprints, formal replay, or the release
thresholds.

When an upstream `fetch` or complete response-body read throws, the loopback
proxy catches it at the only boundary that still has both the original error
and the request fingerprint. An HTTP response is recorded only after its full
body has been read:

- the proxy records one sanitized transport-error ledger entry and returns a
  fixed OpenAI-compatible 502 response with no upstream message or code;
- the proxy performs zero retries. HTTP responses, including non-2xx
  responses, are also never retried by this boundary;
- any observed transport error invalidates discovery even if an existing
  downstream retry later succeeds. Formal replay never starts from such a
  discovery.

GoodMemory and the surrounding benchmark chain already have multiple retry
owners: assisted extraction, embedding, answer generation, reanswer, and judge
paths do not share one attempt budget. Adding another proxy retry would
multiply calls and timeouts, and a downstream retry would add provider inputs
that a successful formal tape hit would not reproduce. Schema 5 therefore
observes the existing behavior and fails closed; it does not add or disable any
client retry.

Every upstream attempt is appended to the active session's sanitized transport
ledger. An entry contains only the application request index and fingerprint,
logical target, outcome, and either HTTP status or a coarse error category,
an allowlisted error code/name, and error-message SHA-256. Unknown codes become
`null` and unknown names become `Error`. It
contains no raw error message, URL, prompt, body, headers, response bytes,
credential, or timestamp. The receipt retains the full ledger plus its count,
error count, and SHA-256; the compact result retains only those aggregates. The
independent verifier recomputes the ledger hash and requires:

- passing discovery has exactly one upstream attempt per logical live request,
  zero transport errors, and `attempts = liveRequests`;
- passing formal replay has zero upstream transport attempts and the SHA-256
  of an empty ledger;
- a failed discovery writes the ledger into the same secret-safe receipt before
  throwing, alongside the schema-4 failure tape.

No schema-5 attempt may begin until failing regressions are added first, the
proxy/runner/readiness implementation is complete, full tests, typecheck, and
coverage are green, an independent review has no unresolved findings, and one
clean `main` commit is frozen. As before, one failed attempt is archived and is
not rerun under the same schema.

## First schema-5 execution is blocked

The single clean schema-5 attempt at candidate `a84855f2` passed the
deterministic boundary: provider-free C1 moved overall evidence recall by
`+0.858369pt`, C40 moved it by `+0.429185pt`, and scenario replay passed 8/8.
These results do not substitute for the provider diagnostic.

Baseline discovery then recorded 352 upstream attempts. Two eval attempts
ended as sanitized `connection` / `AbortError` entries; in each case the
existing downstream retry repeated the same request fingerprint and received
HTTP 200. The proxy added no retry. Schema 5 therefore captured exactly the
recovered transport instability that schema 4 lost, and correctly invalidated
the stage despite recovery.

The 233-row seed report also contained 81 execution-failure rows from the
second conversation, all reporting a separate invalid structured JSON failure.
The transport errors are not claimed to have caused that parse failure. Either
condition independently blocks the stage. The runner stopped before candidate
discovery, union-tape freeze, formal replay, reanswer, official rescore, or the
paired sign test.

The receipt's 352-entry transport ledger re-hashes to its bound SHA-256, and
the strict failure tape retains 350 exact successful HTTP 200 responses. The
complete blocked evidence, losslessly compressed tape, and attribution are
archived under
`reports/release/v0.7/blocked-a84855f2-schema5-transport-and-parse/`. Schema 5
is not rerun. A later live attempt requires another preregistration and a
matching readiness-verifier revision.

## Schema-6 revision: ordered response occurrences

Schema 5 proved that the response tape changed the retry behavior it was meant
to observe. The malformed extraction request fingerprint
`dd2d7c7aff8d07ca5bbc6d5609f9a9c4d0584d54fd5510b1926e9fcfb81baee6`
appears four times at the end of the baseline request sequence, matching the
extractor's frozen four-attempt limit. Only its first occurrence reached the
provider; the next three were tape hits that returned the first malformed HTTP
200 response again. The 81 failed rows were one conversation-level extraction
failure propagated to all of that conversation's questions, not 81 independent
provider failures.

Schema 6 replaces last-write-wins response storage with response occurrences:

- tape schema 3 identifies an entry by request fingerprint plus a contiguous
  zero-based `occurrence`; duplicate fingerprints are required when one logical
  request is attempted more than once;
- entries are serialized canonically by fingerprint and occurrence. The strict
  parser rejects a non-zero start, duplicate occurrence, gap, out-of-order
  occurrence, unknown field, request-identity drift, unreplayable status, or
  response-byte/hash drift;
- every session resets a per-fingerprint cursor. A request consumes the next
  already-frozen occurrence when present; after the session's initial
  occurrences are exhausted, discovery performs exactly one upstream attempt
  and appends the next occurrence;
- a malformed HTTP 200 is therefore occurrence 0. The existing extractor retry
  requests the same fingerprint again and receives a new provider draw as
  occurrence 1. The proxy adds no retry and never parses model output;
- candidate discovery starts from occurrence 0 and reuses the baseline sequence
  byte-for-byte, extending the union tape only when its actual input sequence
  requires an occurrence that baseline did not record;
- each formal arm again starts from occurrence 0 with network-on-miss disabled.
  It must reproduce its discovery request sequence and response-occurrence
  sequence with `hits=requests` and zero misses, live requests, coalescing, or
  sequence mismatches;
- an upstream non-2xx response is stored exactly. A thrown transport operation
  is represented by the existing sanitized fixed 502 response and is also
  stored as its occurrence. Existing client retry owners may recover from
  either; the transport ledger remains bound in the receipt and the formal arm
  must reproduce the same application-visible retry chain without network;
- every failed occurrence must be followed immediately by the same request
  fingerprint, and that retry chain must terminate in a 2xx response. A
  terminal provider failure hidden by an application fallback blocks the run;
- the strict verifier derives occurrence counts from both discovery request
  sequences and requires their exact union to equal the tape. It also recomputes
  non-2xx counts from the transport ledgers rather than trusting compact fields;
- subprocess stdout and stderr are redacted for raw, URL-encoded, and
  JSON-escaped configured credentials before terminal output, hashing, or
  persistence. Credential-bearing failure-tape fingerprints are excluded as a
  complete occurrence group;
- recovered transport/non-2xx occurrences are diagnostics, not a second noisy
  hard gate. They cannot make an incomplete seed, execution failure, judge
  failure, tape miss, or sequence mismatch pass. The hard 1pt release decision
  remains the provider-free C1/C40 pairs plus scenario replay.

This revision changes only the measurement proxy, compact evidence schema from
5 to 6, response tape schema from 2 to 3, and the independent verifier. It does
not change either measured checkout, provider identity, model, prompt, request
fingerprint, response format, temperature, token/reasoning settings, dataset,
question order, concurrency, four-attempt extraction budget, timeout, scoring,
or release threshold.

No schema-6 live attempt may begin until the red/green occurrence tests,
extractor-plus-tape retry regression, runner/verifier mutation tests, full suite,
typecheck, coverage, and an independent read-only review are green on one clean
`main` commit. The baseline remains
`456edd106f29118b3455bf21c43d7b3107b48213`. The candidate is that frozen
implementation commit. Schema 6 authorizes one clean attempt; if it fails, its
artifacts are archived and it is not rerun without another preregistration.

## First schema-6 execution is blocked

The single clean schema-6 attempt at candidate `4d5e2989` passed the
deterministic boundary: provider-free C1 moved overall evidence recall by
`+0.858369pt`, C40 moved it by `+0.429185pt`, and scenario replay passed 8/8.
These results do not substitute for the provider diagnostic.

Baseline provider discovery completed all 233 seed rows with zero seed
execution failures. The schema-3 occurrence tape retained 555 upstream
attempts: 543 HTTP 200 responses, ten HTTP 503 responses, and two sanitized
transport failures represented as synthetic HTTP 502. Both 502 occurrences
and one 503 occurrence were recovered by an immediate same-fingerprint retry.
Nine 503 occurrences across three fingerprints formed terminal three-attempt
chains. GurkiAI described the server-side condition as `auth_unavailable` for
provider `codex` and model `gpt-5.6-terra` on the reranking path.

The seed runner's deterministic reranking fallback kept its question rows
complete, but schema 6 correctly rejected that hidden provider failure. No
candidate discovery, union-tape freeze, formal replay, reanswer, official
rescore, provider comparison, or paired sign test ran. The lossless compressed
tape, redacted logs, complete seed report, receipt, and attribution are
archived under
`reports/release/v0.7/blocked-4d5e2989-schema6-provider-auth-unavailable/`.
This execution does not authorize another schema-6 attempt.

## Release decision

The replacement has three layers. Only deterministic metrics use the 1.00pt
performance threshold.

### 1. Deterministic hard protection

Both commits run fresh provider-free LoCoMo conv-26/30 arms with:

- raw-turn, label-free ingest;
- generalized fusion;
- no extraction, embedding, reranking, answer, or judge provider;
- concurrency 1 and 40 as separate pairs;
- exactly 233 questions, the frozen two-conversation and four-category
  population, and zero execution failures.

For each concurrency pair, overall, category, and conversation evidence recall
must not regress by more than 1.00pt. Any absolute movement above 1.00pt is
recorded for research, but positive movement is not a failure.

The gate does not trust the report's aggregate or per-row recall scalar. It
recomputes every row from `evidenceTurnIds` and `retrievedTurnIds`, then requires
the stored recall, missing-evidence list, full-retrieval flag, and de-duplicated
noise list/count to match before evaluating the hard comparison.

The candidate also runs `bun test tests/scenarios`; it must exit successfully,
report zero failures, and report at least one passing scenario.

### 2. Frozen provider-input and provider-response replay

A runner-local OpenAI-compatible loopback proxy overrides all five registered
provider routes. This LoCoMo chain must actually produce non-empty `eval`,
`embedding`, and `judge` tape lanes only. `assisted` and `reranking` remain
routed so they cannot silently escape if invoked, but their expected zero count
is not presented as wire evidence. The proxy does not modify `src/`, either
detached checkout, public APIs, or stored data.

All seed, reanswer, and official-rescore commands in this provider diagnostic
run at concurrency 1. The command chain is still mechanically derived from the
claim recipe; the diagnostic changes only the protected case selection,
run/output identities, and concurrency. Concurrency 40 remains covered by the
provider-free hard gate above. Provider point results are diagnostic and are
not presented as a throughput or production-concurrency measurement.

The discovery sequence is:

1. Run the baseline with live-on-miss enabled and record ordered provider
   response occurrences.
2. Run the candidate with the baseline tape; go live only for candidate misses
   and extend the union tape. Neither discovery output is scored.
3. Freeze each discovery arm's ordered provider-input manifest. Every entry
   contains the request fingerprint plus logical target, method, path/query,
   canonical-body digest, and semantic-header digest; it contains no raw prompt
   or credential.
4. Atomically write the union tape, read it back through the strict parser, and
   start a new proxy from those bytes.
5. Run fresh baseline and candidate formal arms with live-on-miss disabled and
   the corresponding discovery input manifest installed as the expected
   sequence. A sequence mismatch fails before a tape response is returned.

Every schema-2 request fingerprint is SHA-256 over logical target, HTTP method,
path/query, canonical JSON-body digest, and a digest of response-semantic
headers. The body binds the actual model, prompt/messages, response format,
reasoning effort, token limit, and temperature. Credentials, hop-by-hop fields,
and trace IDs are excluded from the header digest; Authorization is forwarded
during discovery but never persisted. Redirects are not followed. The tape
stores ordered response occurrences, including exact upstream HTTP responses
and the sanitized fixed response for a thrown transport operation. Repeated
fingerprints are valid only with contiguous zero-based occurrence numbers.
Concurrent identical misses remain single-flighted for the generic proxy, but a
passing concurrency-1 release run requires `coalesced=0`; corrupt bytes,
occurrence gaps/reordering, non-matching request/response hashes, and
last-write-wins evidence are rejected.

The report records discovery hits/misses/live calls, formal hits/misses/live
calls, tape SHA-256, entry count, per-target distribution, request-multiset
fingerprints, ordered request-sequence fingerprints, and zero/non-zero sequence
mismatch counts. Each formal arm must be non-empty, satisfy `hits=requests`,
have `misses=liveRequests=coalesced=sequenceMismatches=0`, and reproduce its
discovery arm's exact ordered input sequence and target census against the same
tape. On the first mismatch, the receipt retains the index and expected/actual
request identities (hashes and route metadata only, with no raw prompt). The
independent verifier re-hashes the ordered identities from each receipt instead
of trusting the stored sequence digest. These conditions prove zero live calls
on the registered GoodMemory provider routes; they are not a claim of
process-wide egress isolation. Recovered discovery transport/non-2xx
occurrences remain visible diagnostics. Any final execution failure, judge
failure, tape miss, or input-sequence mismatch invalidates the evidence.
Provider point deltas do not use a raw 1pt release threshold and cannot override
the deterministic gate.

Before either discovery stage can abort, the runner also writes the current
response-occurrence snapshot described above. This preserves malformed,
non-2xx, and sanitized transport responses for attribution without treating an
incomplete stage or execution failure as acceptable evidence.

Execution receipts and readiness recomputation establish repository-local
integrity and command provenance; they are not cryptographically signed CI
attestations. Release authority still depends on running the gate from the
declared clean detached checkouts and retaining the exact generated bundle.

### 3. Paired provider diagnostic

Official per-question correctness produces one exact two-sided sign test:

```text
n = improved + regressed
p = min(1, 2 * sum(k=0..min(improved,regressed)) C(n,k) / 2^n)
```

`n=0` yields `p=1`; `alpha=0.05`. Evidence-recall, strict-answer, and official
point deltas remain descriptive. Significance is diagnostic in either
direction, never a replacement for the deterministic hard gate.

## Claim boundary

The full 1540-question claim must run only after schema 6 passes and is bound to
the release candidate commit. Schema 5 did not pass and cannot authorize that
claim. The existing
0.8799 number is not copied forward. The observed 233-question same-commit
wobble, scaled only as a heuristic by `sqrt(233/1540)`, suggests roughly
0.4-0.7pt full-set run-to-run spread; this is not a confidence interval.

The preferred claim artifact records and replays provider responses so the
published run is byte-reproducible. If any published score instead comes from a
fresh live draw, the claim must state an observed or explicitly heuristic
provider-variance spread. Movements on the scale of 0.8805 versus 0.8799 must
not be attributed to retrieval cues or described as meaningful uplift without
independent evidence.

## Commands and evidence locations

The implementation is runner-only:

```bash
bun run gate:v0.7.3-lifecycle-protection -- \
  --baseline-worktree <clean-detached-v0.7.2-path> \
  --candidate-worktree <clean-detached-candidate-path> \
  --benchmark-root ~/.cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1 \
  --output-dir reports/release/v0.7/v0.7.3-lifecycle-evidence
```

The schema-6 compact result, if the single attempt passes, is
`reports/release/v0.7/v0.7.3-lifecycle-protection.json`; no such passing
artifact was produced. The terminal blocked attempt is archived under
`reports/release/v0.7/blocked-4d5e2989-schema6-provider-auth-unavailable/`.
`gate:v0.7 --strict` re-reads every bound artifact,
re-parses the tape, re-hashes the frozen input sequences, recomputes
deterministic metrics and the sign test, and rejects schema-1 through schema-5
evidence as well as the blocked schema-6 archive. The verifier requires a
passing schema-6 compact result and recomputes the schema-3 occurrence tape
before it can authorize release.

The measurement runner validates the external `cases.json` against the frozen
byte count and SHA-256. The tracked manifest retains that identity and the
original root as provenance; release CI validates the commitment without
requiring the measurement machine's absolute dataset path to exist on Linux.

No branch is created by this protocol. Measurement uses clean detached
checkouts; `main` remains the repository's only branch.
