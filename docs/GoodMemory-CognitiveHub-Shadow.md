# Experimental CognitiveHub shadow integration

The 0.8.3 release source includes the opt-in `goodmemory/experimental/shadow`
ESM and TypeScript subpath. It is separate from the root API and is never installed
in `remember`, conflict resolution, profile handling, or deletion. The registry
release 0.8.1 does not contain this subpath. Registry installation requires 0.8.2
to be published; only the exact prepared artifact set is release evidence.

GoodMemory keeps its Node >=20 runtime boundary and has no CognitiveHub dependency.
The optional bridge is `@cognitive-hub/core/goodmemory-shadow`, with its own JS and
TypeScript entrypoint. CognitiveHub keeps `private: true` and Node >=22; use its
locally packed tarball for this checkpoint. No registry publication is implied.

## Boundary

`src/provider/memoryDecisionShadow.ts` accepts a final admitted/redacted
`SourceMessageRecord`, an exact UTF-16 source span with host-supplied attribution,
a preference candidate, exact scope, and the old preference's complete supporting
evidence and sources. Candidate text must exactly equal the span; this checkpoint
does not try to verify arbitrary model paraphrases or infer target identity.
The trusted host is responsible for selecting the exact target and supplying
the complete source/evidence set, final redaction, and attribution. Hashes prove
consistency, not the truth of those host claims.
The candidate source must match the complete requested scope, including session.
Prior records, evidence and sources are checked against all durable scope
dimensions; supporting evidence can legitimately span multiple sessions.

The factory validates content hashes, scope, links and spans, clones and freezes
the result, and hashes the old record **plus evidence and source clocks** as its
version. This is a read-only stale check, not a transactional storage CAS or a
permission token. A read-only version callback is checked before and after the
provider. No document store or write callback is accepted.

Choices are `keep`, `supersede`, and `abstain`; abstention is mandatory. These are
proposals only. The host supplies eligibility. Unknown choices, extra response
fields, invalid confidence, or fabricated source IDs produce abstention.
`supersede` is additionally removed for quoted/unknown attribution, non-user
sources, inactive records, or missing/equal/older observed source times. Ingest
time and `updatedAt` cannot manufacture chronological authority. This is more
conservative than GoodMemory's explicitly supported legacy both-undated path.
Source clocks use the same strict RFC3339 validator as ordinary admission, so
normalized invalid dates, 24:00 and an unknown `-00:00` offset grant no ordering.

Every report has literal `authorized: false` and `memoryMutated: false`.
Confidence is diagnostic only. There is no `delete` operation. Advice must never
be passed directly to a writer, retirement API, or confirmation mechanism.
`enabled` is false unless explicitly set to true; disabled mode makes no provider
or version-reader call. Timeout/cancellation bounds waiting and signals the
provider; it cannot forcibly terminate external work that ignores cancellation.
Validated responses are detached and frozen before the final version check, so
a provider cannot change a validated choice while that read is pending.
Malformed replay hashes or labels become null diagnostics, including in disabled
mode; invalid source strings are never echoed as a digest, version or baseline.
`agreesWithBaseline` is null when the supplied label is invalid.

The host baseline stays in the replay envelope and report. The provider receives
a separate immutable request without the baseline, whose digest is computed
without that label. Reusing the envelope digest would leak one of only three
possible labels by enumeration. `providerRequestDigest` joins the report to the
provider's replay; agreement remains diagnostic, not a quality claim.

## Optional CognitiveHub bridge

`@cognitive-hub/core/goodmemory-shadow` exports
`createGoodMemoryShadowAdvisor({ decision, timeoutMs?, maxReplayRecords? })`.
Its structural provider contract is assignable to `MemoryShadowProvider`; neither
package imports the other's runtime. It registers finite read-effect previews and
runs the actual Hub `IntentRuntime` in advisory mode. Execute is a hard failure if
unexpectedly reached. Source references are host-bound candidate references, not
claims that the model independently cited or verified those sources.

The bridge accepts no baseline label. The GoodMemory evaluator or a separate host
comparison owns that label. `wait` and `deliberate` become abstention. A failed Hub
turn produces an invalid answer for GoodMemory's strict boundary to reject.
Confidence remains diagnostic and never grants permission.

## Explicit configuration in the example host

The source/local-tarball example now accepts one explicitly selected JSON file via
`examples/cognitivehub-shadow/configured-host.mjs`. Copy the neighboring
`shadow.config.example.json` to your private host configuration and leave
`memory.shadow.enabled` false unless you intentionally enable the advisor.
There is no implicit HOME, `.env`, or configuration-directory discovery.

Enabled configuration requires an explicit Jev model pin and `apiKeyEnv`, the name
of an environment variable whose value you supply yourself. Raw `apiKey` fields
are rejected; never commit a real key or put one into a preset, report, or log.
The example host reads only the named variable when enabled. The Hub factory
`createConfiguredGoodMemoryShadowAdvisor(config, { readEnv, fetch? })` itself has
no ambient environment or filesystem lookup. Missing/blank keys and invalid
enabled configuration fail with value-free errors before an HTTP request.

```js
import { evaluateMemoryDecisionShadow } from 'goodmemory/experimental/shadow';
import { loadConfiguredMemoryShadow, evaluateConfiguredMemoryShadow } from './configured-host.mjs';

const configured = await loadConfiguredMemoryShadow({ configPath: './shadow.config.json' });
const report = await evaluateConfiguredMemoryShadow({
  configured,
  createSnapshot: () => hostOwnedEligibleSnapshot,
  readCurrentVersion: signal => readHostOwnedVersion(signal),
  evaluate: evaluateMemoryDecisionShadow,
});
```

Disabled mode returns before importing the optional Hub package, resolving a key,
constructing a snapshot, reading a version, or making a provider call. Enabled
mode constructs the real Jev provider; a later eligible evaluation sends the
host-approved snapshot content to the configured HTTPS endpoint. The host remains
responsible for privacy, transmission approval, source attribution and redaction.
The tests inject synthetic keys and fake HTTP; no live model call is demonstrated.
The configured timeout bounds Jev/Hub decision waiting; this example leaves the
outer GoodMemory evaluator's separate 1000 ms budget unchanged and does not claim
a single end-to-end timeout or expose an external cancellation signal.

This is an explicit example-host configuration seam, not a production Tachikoma
preset addition. The `memory.shadow` spelling aligns with that possible future
location, but current Tachikoma presets do not accept it. GoodMemory 0.8.2 supplies
the experimental subpath after publication; the optional CognitiveHub bridge
still requires its tested local tarball. Copy the example loader beside your
consumer. There is no automatic
remember/recall hook or automatic application of advice. A completed real
replacement invalidates the old snapshot and must still refuse advice as stale.

History is disabled by default (`maxReplayRecords: 0`). Explicit retention is
bounded to 0..128 completion records. Records contain only request/previous-version
hashes, a decision ID, finite choice/outcome/failure category, elapsed milliseconds,
valid confidence, cleanup status, and actual dispatch/journal counters. These fields
support request correlation, stale/failure triage and no-dispatch regression checks.
They contain no source text, raw scope, prompt, provider error, reason or metadata.
The returned history and each record are detached/frozen. Internal decision storage
uses `recordFacts: false`; full input facts are still supplied to the decider for its
current call. There is no automatic history persistence.

Providers should honor cancellation. Plugin drain waiting is bounded and can report
cleanup pending without claiming forced cancellation. A shared concurrency-one
limiter retains a real call's slot until actual settlement, preventing subsequent
timeouts from dispatching additional calls behind an uncooperative call.

## Run the offline replay

The normal source-evidence replay requires the preference-evidence chronology
included in the 0.8.2 release source. Stable 0.8.1 lacks preference evidence records and is
intentionally refused instead of inventing provenance. Do not replace a released
package or infer a release-quality gate from these fixtures.

1. Build and pack each local candidate with its repository's build instructions
2. Install or extract only those tarballs in a clean consumer, preserving their
   package identities under node_modules
3. Copy `examples/cognitivehub-shadow/replay.mjs` into that consumer, then run:

   `node replay.mjs package:goodmemory package:@cognitive-hub/core/goodmemory-shadow /tmp/shadow-report package:goodmemory/experimental/shadow`

This Node >=22 form resolves only package exports and requires no sibling source
checkout. The same script still accepts explicit local module file paths for
repo-local diagnosis. GoodMemory-only runtime consumers are tested separately on
Node20. Type-consumer tests use the repository's documented strict TypeScript
Bundler-resolution mode. Composite runtime tests use Node22 and Bun.

The replay creates synthetic in-memory GoodMemory stores through the real public
API, captures canonical provenance, calls the actual Hub runtime, checks zero
document mutations and zero dispatches, and writes `replay.json` + `summary.json`.
Cases cover newer/older/equal source times, a quoted third-party injection,
abstention, deliberate disagreement, unknown choice, timeout and stale version.
Baseline labels come from an independent real GoodMemory run, not the provider.
All model choices are deterministic fixtures. Agreement is wiring evidence, not
accuracy, benchmark uplift, production safety certification or default-enablement
evidence. Reports include synthetic source text; real deployments must govern
retention and transmission of evidence separately.
