# Preference Identity Pre-API Research

This is a research protocol, not a product or API commitment. It answers two
questions before GoodMemory adds preference identity or conflict contracts:

1. Can an assisted extractor atomize preferences and emit stable conflict-slot
   keys across paraphrase, language, context, and repeated calls?
2. Do the repository fixtures contain enough preference changes to justify a
   first-class conflict-adjudication workflow?

The experiment deliberately does not change `src/`, public types, storage,
projection, HTTP, CLI, Inspector, package exports, or release metadata.

## Experiment A: key stability

The frozen manifest is
`fixtures/research/preference-identity-v1/manifest.json`. It contains exactly
30 semantic groups:

- 20 atomic groups covering opposite values in ten conflict slots;
- 10 compound groups that require two or three independent preference
  candidates, including a real three-atom group;
- six variants per group: English and Chinese in general, work, and personal
  study contexts.

Every variant runs twice in each of two isolated arms: `30 * 6 * 2 * 2 = 720`
assisted-extractor calls total, 360 open-key calls and 360 closed-key calls.
The open-key prompt and frozen schema identity expose only the open string-key
contract. The closed-key prompt and frozen schema identity expose only the
closed vocabulary. Neither arm sees the other arm's key field or vocabulary,
and neither prompt receives the manifest-derived canonical value vocabulary,
so the comparison cannot be created by copying gold answers into model input.
Expected slots and values remain manifest-bound offline scoring labels only.
`other` is an escape value and is never a conflict-matchable identity.

The independently frozen protection cohort lives at
`fixtures/research/preference-identity-v1/protection-cohort.json`. It selects
three variants from every group before any model call: 90 variants and 180
repeated calls per arm, 360 protection calls total, balanced within each arm to
45 English / 45 Chinese variants and 30 variants per context. The complementary
90 variants produce 180 development calls per arm. Each arm is decided only by
its own protection rows; development, overall, and opposite-arm metrics remain
visible diagnostics and never alter that decision.

The v2 preregistration lives in
`fixtures/research/preference-identity-v2/preregistration.json` and binds the
unchanged v1 manifest and protection-cohort bytes by SHA-256. The original v1
preregistration remains at
`fixtures/research/preference-identity-v1/preregistration.json` for audit. A
live report must retain the manifest, preregistration, prompt, input, and
raw-result fingerprints, while never persisting provider credentials.

The protocol also freezes the complete effective extractor contract: the
provider memory-extractor system prompt, an arm-specific canonical-v1 parser
schema identity, `json_object` response mode, and all 360 rendered custom
prompts in each arm. The provider-visible prompt explicitly names every
required canonical candidate field and the nested preference metadata paths.
Per-arm component hashes and one aggregate SHA-256 are preregistered and
recomputed before dry or live execution. The 720-call input plan binds the arm
into both `callId` and `inputFingerprint`; provider-input fingerprints exclude
`expectedAtoms`, whose separate manifest hash binds the offline gold oracle.
Stale per-call fingerprints or any aggregate drift abort the protocol.

### Invalidated v1 pilot

The first v1 live attempt was stopped after 173 of 720 open-key calls because
all 173 responses failed the canonical parser for the same tooling reason. All
173 responses contained decodable JSON, but all 176 returned candidates lacked
the required `content` field and placed `preferenceValue` at the candidate top
level instead of `metadata.preferenceValue`. The parser schema had been bound
by hash but the provider-visible prompt had not named those required paths.

This is not an open-key quality result and contributes no row to the v2
experiment. The ignored per-call raw evidence remains in the exclusive v1 run
directory; the tracked fingerprint and diagnosis are recorded in
`reports/eval/research/preference-identity/preference-independent-arms-v1/invalid-pilot.json`.
The successor is a new v2 protocol and run directory. It changes the
provider-visible canonical output contract and adds targeted rejection of
candidate-level `preferenceValue` or experimental-key fields; manifest,
protection cohort, model, retry policy, thresholds, and scoring stay frozen.

### Completed v2 result

The v2 run completed all 720 planned provider attempts at clean commit
`793d18bee37bc203e631c89cdec12fac4b9bd014`. It used the pinned
`gpt-5.6-terra` Gurki endpoint, temperature 0, concurrency 4, and no retries.
The tracked aggregate report and raw-output fingerprints are under
`reports/eval/research/preference-identity/preference-independent-arms-v2/`;
the 720 per-call raw payloads remain local and ignored.

| Protection metric | Open key | Closed key | Gate |
| --- | ---: | ---: | ---: |
| Execution failures | 0 | 22 | 0 |
| Preference capture | 0.9889 | 0.0056 | >= 0.95 |
| Atomicization precision / recall | 0 / 0 | 0 / 0 | >= 0.95 / >= 0.95 |
| Compound precision / recall | 0 / 0 | 1 / 0 | >= 0.95 / >= 0.95 |
| Exact key-set agreement | 0.0556 | 0.0056 | >= 0.95 |
| Repeat consistency | 0.2222 | 0.8667 | >= 0.99 |
| Context agreement | 0.9277 | 1.0000 | >= 0.95 |
| Parse or missing-key count | 2 | 196 | 0 |
| Cross-dimension collisions | 0 | 0 | 0 |

Both arms are blocked. The closed-key compound precision of 1 has zero recall
and does not rescue an arm that captured almost no usable keyed preferences.
The final preregistered recommendation is `no-api`: neither open keys nor the
closed vocabulary may enter a v0.8 product contract. The rules-only baseline
also captured only one third of inputs and emitted no identity slots, so there
is no LanguagePack parity evidence. A later protocol would need a measured
extraction-routing change and a new version; this result cannot be tuned or
pooled into it.

Atom correctness is not inferred from candidate count. In each key mode, every
candidate is matched one-to-one against the frozen expected slot, registered
canonical value, and expected context. The open key must equal the frozen slot;
the closed key must equal that slot or its preregistered `other` mapping. No
key normalization is permitted: open-key equality, closed-vocabulary
membership, key-set agreement, repeated-call consistency, and collision
grouping all compare the raw key string byte-for-byte. Case changes, leading or
trailing spaces, hyphens in place of dots, and repeated dots are failures rather
than aliases. Value whitespace/case and context formatting use their separately
registered normalizers; those normalizers never touch a key. No modal key is
learned from model output. Equal counts with a wrong dimension, value, or
context therefore reduce both precision and recall. Exact key-set agreement is
also scored directly against the frozen expected slots.
Cross-dimension collision scoring scans every candidate in every successful
atomic and compound row. A known canonical value assigns the candidate to its
frozen semantic slot even when the candidate is extra or otherwise fails atom
matching, so an injected extra cannot evade the zero-collision gate.

The gates are:

| Metric | Gate |
| --- | ---: |
| execution failures | `0` |
| preference capture rate | `>= 0.95` |
| atomicization precision | `>= 0.95` |
| atomicization recall | `>= 0.95` |
| compound atomicization precision | `>= 0.95` |
| compound atomicization recall | `>= 0.95` |
| paraphrase exact key-set agreement | `>= 0.95` |
| repeated-call consistency | `>= 0.99` |
| context agreement | `>= 0.95` |
| unintended cross-dimension collisions | `0` |
| parse failures or missing keys | `0` |

Every report also records the distribution of `other` by group and context.
`other` means “store and flag without automatic conflict matching”; it never
means reject the preference write. In the closed-key summary, a key outside the
frozen vocabulary is a protocol parse violation and counts against the zero
parse/missing-key gate. Because `other` is not conflict-matchable, repeated
`other` assignments across gold dimensions do not count as a cross-dimension
collision.

Provider retries are disabled with `retryLimit: 0`, and the live runner makes
one direct OpenAI-compatible text request per planned row. The run requires
exactly 720 model-usage attempts for 720 planned calls. Schema/parse failures
and missing keys therefore reach the corresponding execution and
parse/missing gates directly instead of being hidden by a successful retry.

Either key scheme passes only if all gates pass in its independently scored
protection summary. The preregistered recommendation advances open keys when
that protection summary passes, otherwise closed keys only when their
protection summary passes, otherwise no identity API. A pass is
model/prompt-specific evidence for another private design stage, not permission
to publish an API: simple `I prefer ...` messages often stop in the rules-only
LanguagePack path, so production identity still needs rules-only parity. The
rules-only baseline uses the same frozen slot/value/context one-to-one oracle,
includes every two- and three-atom compound row, and never substitutes
`min(expected, actual)` for semantic correctness. Its current identity
precision and recall are expected to be zero because the current rules-only
records do not emit the proposed identity slot contract.

### Commands

Validate the frozen call plan without model calls:

```bash
bun run scripts/run-preference-identity-stability.ts
```

Run both pinned isolated arms when the assisted-extractor credentials are
available, from a clean independent research commit:

```bash
bun run scripts/run-preference-identity-stability.ts \
  --live \
  --max-concurrency 4 \
  --run-id preference-independent-arms-v2
```

The live command refuses a dirty tree, a different run ID, or an alternate
output directory. Its fixed path is
`reports/eval/research/preference-identity/preference-independent-arms-v2/`.
The directory is created exclusively before any provider request; an existing
directory aborts the run, and every artifact write uses create-new semantics.
After every provider attempt finishes, its raw evidence is immediately written
with `wx` to a safe per-call file under the Git-ignored `raw-calls/` directory
before that worker starts another call. A process interruption therefore leaves
the completed calls recoverable, while the existing fixed run directory blocks
an accidental overwrite or silent restart. The only trackable artifacts are
`report.json` and `raw-fingerprints.json`; the latter
contains exactly `{arm, callId, rawFingerprint}` per call plus aggregate hash
and count, plus the call-plan aggregate input fingerprint and count. The local,
Git-ignored `raw-results.jsonl` is created with `wx` only after all calls finish
and contains one record per call
with `arm`, `callId`, execution/parse/missing-key diagnostics,
`rawOutputAvailable`, `rawFingerprint`, and `rawPayload`. On a provider response,
`rawPayload` is the original completion text before thinking-block stripping,
JSON parsing, normalization, or schema validation. Parse/schema failures retain
that text with `rawOutputAvailable=true`; transport failures record no invented
completion and set it to `false`. The fingerprint is SHA-256 over exactly the
persisted payload. Credentials and row-level rules-only payloads are not
persisted. The
report records the model, gateway,
temperature, retry limit, Git commit, provider-attempt count, token usage,
effective-prompt/prompt/manifest/preregistration/protection hashes, and both
input and raw fingerprint aggregates. Token usage is reported, while
`providerBilledUsd` and `estimatedUsd` are both `null` with the explicit reason
that no frozen verifiable `gpt-5.6-terra`/Gurki tariff is registered. A prompt,
model, manifest, protection selection, threshold,
normalization, or exclusion change requires a new protocol version; results
from different versions are never pooled.

## Experiment B: fixture census and policy challenge

`scripts/analyze-preference-conflicts.ts` keeps two denominators separate:

- a deterministic census of the checked-in eval scenarios and behavior
  scenarios using the current rules-only extractor;
- a balanced 30-case synthetic challenge with five each of explicit updates,
  same-category different-dimension coexistence, contextual coexistence,
  synonymous repeats, compound partial updates, and legacy unkeyed data.

The synthetic cohort compares three policies:

- current destructive replacement: the new value remains but prior lineage is
  deleted;
- recency with lineage: the latest same-slot value applies, all source records
  remain, and legacy unkeyed records stay active but flagged;
- freeze: same-slot values stop applying until adjudication and legacy unkeyed
  records stop contributing as the rejected design proposed.

For each policy, the challenge reports expected-active-instruction exact-match
accuracy, silent data loss, false conflict/freeze rate, general-fallback
availability, lineage recoverability, and cases that cannot be recovered using
only the existing `reviseMemory`/`forget` operations. The last metric counts
lost lineage: those operations can mutate or remove a surviving record, but
cannot reconstruct content and IDs that destructive replacement already
deleted. These are synthetic policy consequences, not observed incidence.

The metric oracle is explicit: active-instruction accuracy is the fraction of
cases whose entire active-label set exactly matches the fixture; silent data
loss means expected lineage was removed without a warning; false
conflict/freeze means a warning or freeze was introduced where the fixture
expects none; general-fallback availability is the fraction of cases where the
fallback remains usable; and lineage recoverability requires the old record and
identity to remain available. All 30 expected outcomes keep the general
fallback available. The freeze simulation disables it for same-slot cases, as
the rejected design proposed.

Run the offline analysis with:

```bash
bun run scripts/analyze-preference-conflicts.ts
```

To persist a deterministic report explicitly:

```bash
bun run scripts/analyze-preference-conflicts.ts \
  --output-dir reports/eval/research/preference-identity/fixture-census \
  --run-id current
```

The only permitted aggregate destination is
`reports/eval/research/preference-identity/fixture-census/current/report.json`.
That report records the source Git commit and dirty state. The exact aggregate
file is whitelisted for tracking; fixture inputs and any raw corpus are not.
Alternate output directories or run IDs are rejected.

The fixture census measures only repository coverage. The scenarios are
templated, contain little preference-change history, and are not user telemetry.
The synthetic cohort is excluded from every incidence denominator. Neither may
be described as production conflict incidence or adoption evidence.

The census loads and hashes
`fixtures/research/preference-conflict-v1/census-preregistration.json` and
fails if the registered file, scenario, or user-turn counts drift. The current
rules-only records expose legacy categories, not frozen identity slots, so
same-slot changes, recency appropriateness, and ambiguity counts/rates are
reported as `null`; legacy same-category value changes are reported separately
and never relabeled as same-slot evidence.

Fewer than 20 natural same-slot changes—or an identity-unavailable corpus—is
preregistered as `underpowered_no_adjudication`. That result cannot prove
conflicts are absent and explicitly disallows a new `resolvePreferenceConflict`
API. A first-class adjudication design is considered only after at least 20
natural changes exist and either recency is appropriate in less than 90% of
them or ambiguous conflicts affect more than 5% of preference-bearing scopes.

### Completed conflict result

The tracked fixture report covers 46 eval scenarios plus six behavior
scenarios. The current rules-only records expose 44 eval preference candidates
and one behavior preference candidate, but no identity slots and no observed
legacy-category value-change sequence. The result is therefore
`underpowered_no_adjudication`; all same-slot, ambiguity, and recency-incidence
metrics remain `null` rather than being invented from legacy categories.

On the separate 30-case synthetic challenge, recency-with-lineage matched the
expected active instructions in 30/30 cases with zero silent loss, full general
fallback, and full lineage recoverability. Destructive replacement and freeze
each matched only 10/30; destructive replacement lost lineage in every case,
while freeze introduced a 0.5 false-conflict/freeze rate and reduced fallback
availability to one third. This synthetic result supports recency-with-lineage
as the default *if* identity becomes viable later. It does not estimate
production incidence and does not authorize an adjudication API or review UI.

## Track 2 exit decision

- Reject open keys for v0.8.
- Reject the current closed vocabulary for v0.8; `other` remains conceptually
  store-and-flag, but this run produced no usable `other` evidence.
- Do not add identity fields, conflict outcomes, freeze behavior,
  `resolvePreferenceConflict`, concurrency contracts, HTTP/CLI endpoints, or
  Inspector review queues.
- Keep legacy preferences active. Keep the v0.7.3 recency-with-lineage bug fix
  and existing `reviseMemory` / `forget` recovery surface.
- Any renewed identity work requires a new preregistered routing experiment;
  it is not part of the unpublished v0.8 implementation plan.

## Verification

```bash
bun test tests/unit/preference-identity-research.test.ts
bun run typecheck
```

Passing these commands proves the offline protocol, metrics, fingerprints,
fixture census, and policy simulation are executable. It does not substitute
for the 720-call live assisted-extractor run.
