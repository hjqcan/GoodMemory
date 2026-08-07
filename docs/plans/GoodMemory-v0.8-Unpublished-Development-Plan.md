# GoodMemory v0.8 Unpublished Development Plan

Status: planned, not release-authorized

v0.8 development remains real, but it will not be tagged, published to npm, or
presented as a shipped release. Because this repository now uses only `main`,
breaking v0.8 source changes must wait until the v0.7.3 release commit is
actually tagged and published. Landing them earlier would make `main` cease to
be a valid v0.7.3 candidate.

## Evidence boundary

The preference identity v2 experiment completed 720 calls and rejected both
open and closed keys. The fixture census was identity-unavailable and
underpowered for adjudication. Therefore v0.8 contains no preference identity
or conflict API. Synthetic policy evidence favors recency-with-lineage over
destructive replacement or freeze, but cannot authorize production incidence
claims or a review workflow.

## Scope after v0.7.3 publication

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
- No v0.8 tag, npm publish, GitHub release, or public benchmark projection.

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
- The work remains on `main` as an unpublished development state only after
  v0.7.3 has been published and verified.

## Reopening preference identity

Identity work can reopen only under a new protocol version that measures a
real extraction-routing change and proves both assisted extraction and
rules-only LanguagePack parity on a frozen protection cohort. The rejected v2
rows may be retained as history but never pooled into the new decision.
