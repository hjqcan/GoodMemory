# GoodMemory v0.8 Unpublished Development Plan

Status: Phase 73 internal lane closed; final exact-artifact release verification

The maintainer's 2026-09-04 direction is to finish v0.8 and Phase 73 together
on `main`, then publish v0.8. The previous v0.7.3 sequencing constraint has
been discharged; the release source now targets 0.8.3. The historical initial-release requirements below remain a record of 0.8.0; 0.8.1+ patch preparation uses the portable current-product profile and does not require the private Phase 73 raw capture. Do not present this
working tree as a shipped 0.8 release. The Phase 73 Level-2 experiment freezes
its runner dependency closure, including package.json, bun.lock, and
tsconfig.json. Its process stopped in the 2026-09-05T01:36:35Z machine reboot;
one frozen file had changed beforehand. The maintainer authorized recovery
on 2026-09-05: the incomplete ledger and mutable roots were backed up, the
original 171-file runner closure was materialized and hash-verified outside
the working tree, and the same run resumed after passing its full preflight.
The source-identity incident remains disclosed and requires independent
review before this run can close; recovery does not prove historical source
stability. The 2026-09-14 disposition below now permits version finalization.

On 2026-09-14 UTC the complete 720-row / 360-pair sealed Level-2 projection,
fresh four-input independent review, and final machine gate were accepted.
The independent scientific/incident companion review supports closing only an
internal negative result: positions 2+ have 147/270 comparable pairs, 122 vs
134 passes, 6 rescues / 18 regressions, and -8.1633 percentage points. The
preregistered advantage rule is unmet. Original failures and interrupted
attempts are retained; strict host identity still rejects, historical source
stability is not proven, and no public effect claim is authorized. See the
Phase 73 board's 2026-09-14 entry for exact hashes and external evidence roots.

The maintainer's 2026-09-06 direction was to continue until they could
publish 0.8. This supersedes automatic publication: prepare and verify local
changes and artifacts, then hand off readiness. Do not run npm publish, push
a tag, upload release assets, or create a GitHub release without a new explicit
publication request. A green gate is not publication authorization.

This authorization boundary was superseded by the maintainer's explicit
request to publish v0.8, followed by approval on 2026-09-14 UTC of the
single-sealed-run runner-directory relocation evidence policy. Publication
is now authorized after the existing release gates pass. This does not
authorize changing the experiment, scores, failure records, public claims,
or user memory scopes. New verification checkouts, logs, temporary files,
and release artifacts belong on the data disk mounted at `/Volumes/data`
(`/data` is not a mounted path on this host).

The local `release:prepare` run owns the exact artifact set and packs once.
After validation and publication, `scripts/release/verify.ts --artifact-dir`
checks the same source/tag, complete check inventory, tarball, manifest,
evidence archive, and plugin ZIP without rebuilding. The GitHub release
workflow is read-only and verifies those published assets plus npm integrity;
tag pushes no longer start a second pack or publish. No npm credential is
copied to GitHub secrets as part of this flow.

On 2026-09-07 the maintainer confirmed that this is the only task responsible
for the current checkout and authorized completing the existing changes.
The development changes can be reviewed, corrected, and committed on `main`
while Phase 73 continues from its separate frozen runner closure. This does
not authorize changing that experiment or migrating existing user memory.
Publication authorization is the later explicit request recorded above, not
this historical development authorization.

## Evidence boundary

The preference identity v2 experiment completed 720 calls and rejected both
open and closed keys. The fixture census was identity-unavailable and
underpowered for adjudication. Therefore v0.8 contains no preference identity
or conflict API. Synthetic policy evidence favors recency-with-lineage over
destructive replacement or freeze, but cannot authorize production incidence
claims or a review workflow.

## Breaking-change scope

1. Remove the public fields frozen and deprecated in v0.7.3:
   `FactMemory.accessCount`, `FactMemory.lastAccessedAt`,
   `FeedbackMemory.lastUsedAt`, `RecallCandidateTrace.usageScore`,
   `RecallCandidateTrace.outcomeScore`,
   `ExperienceMetrics.touchedFactCount`, and
   `ExperienceMetrics.reinforcedFeedbackCount`.
2. Remove their constructor defaults, revision resets, projection exclusions,
   trace formatting, and type-surface fixtures. Where internal selection still
   needs evidence quality, use the existing `evidenceScore` directly instead
   of retaining `outcomeScore` as an alias.
3. Keep freshness as query-time recall policy and TTL as maintenance. Do not
   reintroduce recall touches, usage ranking, maintenance decay, or confidence
   mutation from retrieval exposure.
4. Preserve preference supersession lineage and active-only recall exactly as
   shipped in v0.7.3.

## Explicit non-scope

- No open-string or closed-vocabulary identity field.
- No `conflicted` lifecycle/outcome, freeze-on-read, legacy disablement, or
  suspended general fallback.
- No `resolvePreferenceConflict`, optimistic-concurrency protocol, HTTP/CLI
  endpoint, Inspector queue, database, scheduler, or migration service.
- No claim that the `general_preference` coexistence problem is solved. Without
  a stable identity boundary, unrelated legacy-category values remain a known
  limitation with retained lineage rather than silent deletion.
- No remote v0.8 tag push, npm publish, or GitHub release before Phase 73 closure
  and all release checks pass. A local-only source tag binds the stable
  `release:prepare` check before publication. Internal Phase 73 evidence never authorizes a public
  coding-effect benchmark claim, even if its scientific result is positive.

## TDD order

1. Add type-surface failures proving the deprecated fields are absent from
   public records, traces, and experience metrics.
2. Remove the domain fields and factory defaults, then update revision and
   export/projection behavior.
3. Collapse trace consumers onto `evidenceScore`; remove usage/outcome text and
   selector plumbing without changing selected memory IDs on deterministic
   scenarios.
4. Update storage round trips and package-boundary consumers. Existing stored
   JSON may contain extra historical properties, but v0.8 does not read,
   expose, migrate, or rewrite them.
5. Run focused domain/recall/revision/export/type/package suites, then
   `bun test`, `bun run typecheck`, and `bun run test:coverage`.

## Acceptance boundary

- All seven deprecated public fields are absent from source types, factories,
  serialized public output, declarations, and package consumer fixtures.
- Retrieval exposure still performs no positive reinforcement writes or
  ranking boosts.
- Preference history remains exportable and revisable; recall returns only the
  active latest legacy-category record.
- No identity/conflict public contract exists anywhere in `src/`, package
  exports, HTTP, CLI, Inspector, or projections.
- All development remains on `main`. Final publication requires a clean,
  committed source identity, the Phase 73 Level-2 projection and independent
  evidence review, documented interpretation of its preregistered result,
  and a passing `release:prepare` manifest for the exact 0.8 tarball. A
  documented negative result closes Phase 73; partial execution does not.

## Release preparation checklist

- Resolve the confirmed default workspace identity collision described below;
  verify same-basename isolation and explicitly document the old-scope boundary.
- Completed: project, independently review, verify, and interpret the sealed
  Level-2 ledger under the approved narrow relocation policy, retaining the
  source incident and all missingness. This is not historical-stability proof.
- The source metadata and migration guide now target 0.8.0. The experimental
  tarball remains separate. The plugin enables ten tools, including
  `goodmemory_write_note`; final native acceptance must use the exact release
  tarball and that descriptor before publication.
- Run full tests, typecheck, coverage, build, strict public-claim checks,
  projection/storage scale checks, and real Postgres checks.
- Validate pages import, durable round trip, invalid-input rejection, and
  recall in fresh Node and Bun consumers of the exact packed tarball.
- Publish the passing manifest's exact artifacts under the explicit current
  authorization. Verify npm metadata,
  fresh installation, the source tag, and GitHub release before calling 0.8
  shipped.

## Kimi readiness follow-up (2026-09-07 UTC)

- The native Kimi 0.41.0 loop now verifies manual approval before a real model
  write, fresh-session recall without the answer in its input, trace linkage
  to the written record, and isolation between same-basename projects under
  different absolute paths. This is isolated local candidate evidence, not
  independent adoption or published 0.8 evidence.
- The MCP startup timeout is 300 seconds. A same-tarball native control with
  an injected 130-second startup delay fails at 120 seconds; the 300-second
  candidate connects with nine tools. This verifies the timeout behavior, not
  a guaranteed network cold-start latency.
- Native model use exposed invented optional date fields. Remember, recall,
  and trace instructions now require omitting unspecified temporal controls;
  descriptions alone did not resolve it: a fresh candidate repeatedly sent
  empty strings and failed validation. Schema-only request tracing confirms
  Kimi sent optional properties without `strict`; it does not establish what
  the model gateway did internally. The MCP wire contract now accepts `null`
  for optional inputs and normalizes it to `undefined` before core handlers.
  Required fields, empty/invalid timestamps, and invalid timezones remain
  rejected, with no rejected-write mutation. This is an MCP input boundary,
  not a change to library/HTTP/storage contracts. The rebuilt development
  candidate passed the full native sequence at 2026-09-07T10:43Z: first write
  with null optionals, fresh-session recall, trace linked to the written ID,
  and same-basename/different-path isolation. All four MCP calls were singly
  approved and successful without an MCP retry or Bash clock lookup. Nine
  earlier provider-failed turns remain preserved. This does not establish
  general provider availability or semantic retrieval; this local run used
  rules-only recall. The candidate is still a nine-tool development tarball
  labeled 0.7.5; final 0.8 ten-tool packaged model acceptance remains required.
- The 0.8 release profile generates a deterministic seven-file plugin-only
  ZIP and binds it into the authoritative manifest/evidence archive. The
  workflow includes that optional ZIP in its prepared artifact set, while
  the 0.7 profile remains unchanged. A public ZIP URL is not available before
  publication. Native Kimi installed the development ZIP from loopback HTTP
  after its trust prompt; every managed file matched the ZIP byte-for-byte,
  and reload connected the version-pinned published runtime with nine tools.
  Public GitHub release-asset download acceptance remains unverified.
- External raw evidence and verifiers are under
  `/Volumes/data/GoodMemory-external/v08-readiness-20260907-nagZHU`.
  `model-r4-verification.json` is the unchanged full verifier's pass;
  `model-r4-completion-20260907T1026Z.json` binds the source, immutable final
  sessions, final model reply, privacy scan, and earlier failure prefixes.
  Initial invalid local-tarball fixtures, date validation failures, provider
  retry errors, and bare-GitHub-URL timeout remain preserved.

## Workspace identity collision: repaired, pending final release validation

Confirmed on 2026-09-05 in the published 0.7.5 standalone MCP and pre-fix
`main`. `src/host/managedFiles.ts:resolveWorkspaceId` derived the default ID
from `basename(workspaceRoot)`. Consequently, different absolute paths such
as `/left/project-a` and `/right/project-a` select the same workspace scope
when user/agent/storage settings are otherwise equal. A read-only MCP probe
recalled the same synthetic stored fact from both paths; `/right/project-b`
correctly returned no such fact. Different directory names passing an
isolation test do not establish isolation for distinct absolute paths.

The resolver is shared by standalone MCP, installed-host global activation,
bootstrap, and workspace installation. This is not caused by the separately
reported corrupt legacy database. No original user database or existing scope
was changed during reproduction.

The maintainer approved the correction and recovery work on 2026-09-05
("可以，继续完成"). The resolver now derives `workspace-<sha256>` from the
lexically normalized absolute path, preserving explicit IDs. Seven focused
identity tests cover path normalization, aliases, installed global/opt-in,
standalone, bootstrap, and legacy configured-ID preservation. A real MCP
process over shared SQLite proves same-basename write/recall/delete isolation,
explicit sharing, and preservation of legacy records. The first focused run
passed 74 tests; final candidate-wide validation remains required.

Existing stored/configured IDs
must not be silently remapped, merged, copied, or deleted: records under an
already-colliding legacy ID cannot safely be attributed to one original path
from that ID alone. No automatic scope migration is implemented. Symlink/case
spellings stay separate, and moves/clones get new defaults; the migration
guide records the explicit-sharing and manual-reconciliation boundary.

## Scope expansion: memory-as-data program (2026-09-01)

The memoryfield audit in
`docs/GoodMemory-Benchmark-Optimization-Research-2026-07.md` added a second
v0.8 lane, sequenced after the deprecated-field removals above:
`task-board/79-phase-75-note-memory-and-interchange.txt` with
`adr/ADR-010-note-memory-kind-file-mirror-and-interchange.txt`. It adds a
first-class `note` kind with a projection version bump, so it ships in the same
minor as the field removals rather than as a separate rebuild.

## Progress

- 2026-09-01: the seven deprecated fields are removed from source types,
  factories, revision, projection neutral-field sets, ranked candidates, and
  traces; `whyReturned` reports `evidenceScore=` in place of `outcomeScore=`.
  Type-surface pins live in `tests/types/deprecated-telemetry-fields.types.ts`.
  Stored JSON written by earlier releases may still carry the properties; v0.8
  neither reads nor rewrites them. Not yet tagged.
- 2026-09-02: WP1 `note` memory kind, WP2 opt-in long-record admission, and
  WP3 index-plus-topics Markdown artifacts landed (see
  `task-board/79-phase-75-note-memory-and-interchange.txt`); the recall
  projection pipeline is `gm-projection-v6`, so existing scopes rebuild once.
- 2026-09-02: WP4 interchange landed: `memory.importMemory`, the
  `exportMemory().pages` bundle, CLI `import-memory`, HTTP `POST /memory/import`,
  Python client `import_memory`. ADR-010 §9 records the fixed specifics.
- 2026-09-02: WP5 read-only workspace file mirror landed
  (`governance.fileMirror`, installed-host `--file-mirror`).
- 2026-09-02: review hardening of WP4/WP5: durable import restores every
  envelope collection, validates every record against a typed runtime
  schema, and rolls back on failure;
  split chunks are checked against the cap; the mirror binds one root to one
  durable `scope` and recovers a failed swap.
- 2026-09-02: WP6 `memory_context_frame` landed default-on for prompt
  fragments with config and per-call opt-outs.
- 2026-09-02: WP7 `goodmemory --schema` and the Memory Artifact and
  Interchange Spec landed; the Phase 75 long-record admission gate script and
  runner flags landed (fresh-install default still pending the gate).
- 2026-09-02 Phase A-C close gate: full `bun test` green, `bun run typecheck`
  clean, `bun run build` clean, `bun run test:coverage` 92.40% overall with
  0 failures; ADR-010 accepted. Not committed, not tagged.

## Phase 75 default-enablement follow-up (2026-09-05)

The full provider-free paired protection gate passed on 500 LongMemEval
cases and 1,986 LoCoMo questions per arm, with no execution errors and all
22 type/category slices inside the predefined limits. Fresh Codex and Claude
configs now enable long-record admission. Existing configs retain absent
keys and explicit opt-outs; the library and file mirror remain opt-in.
Note-page byte preservation and broader-scope mirror invalidation were also
fixed with red/green regressions. Detailed evidence, source identities,
limitations, and final validation status are recorded in
`reports/quality-gates/phase-75/default-enablement-20260905.md`.

Final main verification: `bun test` 7,145 pass / 60 skip / 0 fail;
`bun run test:coverage` 6,993 pass / 60 skip / 0 fail, 92.45% overall and
94.47% storage, with every coverage threshold passed. Typecheck, build, and
actual final-package consumers on Node 20/22/24 and Bun passed. The report
binds source identities and preserves earlier failed environment runs.

This closes the Phase 75 fresh-install-default decision only. It does not
resolve the workspace identity P1 above, resume Phase 73, change public
benchmark declarations, or authorize publishing v0.8.

## Reopening preference identity

Identity work can reopen only under a new protocol version that measures a
real extraction-routing change and proves both assisted extraction and
rules-only LanguagePack parity on a frozen protection cohort. The rejected v2
rows may be retained as history but never pooled into the new decision.
