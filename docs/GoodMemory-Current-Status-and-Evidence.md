# GoodMemory Current Status and Evidence

This is the compact current-truth entrypoint. Historical narrative has been removed from this file; use `docs/archive/quality-gates/README.md`, generated reports, and git history for phase-by-phase provenance. Product scope remains in `docs/GoodMemory-PRD.md`, and execution order remains in `task-board/00-README.txt`.

## Stable OSS Surface

- Current registry state: npm `latest` resolves to `goodmemory@0.7.2`. The
  peeled `v0.7.2` tag resolves to commit
  `456edd106f29118b3455bf21c43d7b3107b48213`; release workflow run
  `30733828784` verified the exact npm artifact before publishing the non-draft
  GitHub Release.
- `main` contains the v0.7.3 lifecycle-truthfulness candidate and the
  replacement protection runner, but v0.7.3 is not published. The first
  provider-backed 233-question gate remains archived as blocked; its 11/15
  paired split has exact two-sided `p=0.5571970939636236`, while same-commit
  provider variance exceeded the original 1pt threshold. The first schema-2
  attempt at candidate `1b3efe83` passed the deterministic arms and provider
  discovery but is also permanently blocked: of its first 214 formal rows, 40
  ordered retrieved-turn arrays differed from discovery (38 set differences
  and two order-only differences), and baseline formal replay missed the exact
  request census. Its incomplete evidence and attribution are archived at
  `reports/release/v0.7/blocked-1b3efe83-replay-miss/`; no full claim rerun,
  tag, npm publish, or GitHub Release followed. The first schema-3 attempt at
  candidate `113477d3` is now also blocked. Its provider-free C1/C40 arms were
  neutral-to-positive and scenario replay passed 8/8, but baseline provider
  discovery produced invalid structured JSON and 152/233 seed execution
  failures. The run stopped before candidate discovery or formal replay. Its
  evidence and attribution are archived at
  `reports/release/v0.7/blocked-113477d3-provider-json/`. The malformed response
  bytes were not persisted because the failure preceded the union-tape write;
  schema 4 then ran once at candidate `68d5d7f1` and is also blocked. Its
  deterministic C1/C40 arms were neutral-to-positive and scenario replay
  passed 8/8, but baseline provider discovery produced 233 execution failures
  after an OpenRouter embedding fetch exposed a certificate-verification
  error. The runner preserved 29 exact successful 2xx responses in its
  failure tape before aborting; the transport exception itself was visible in
  the parent terminal but was not persisted in the stage receipt, so it is not
  claimed as the uniquely proven cause of every downstream failure. The
  evidence and attribution are archived at
  `reports/release/v0.7/blocked-68d5d7f1-openrouter-tls/`. Schema 4 will not be
  rerun. Schema 5 then added a sanitized transport-attempt ledger and
  fail-closed proxy handling with zero new retries. Its single attempt at
  candidate `a84855f2` passed the deterministic C1/C40 and 8/8 scenario layers,
  but baseline discovery recorded two recovered eval transport errors and a
  separate structured-JSON seed failure affecting 81 rows. It stopped before
  candidate discovery or formal replay and is archived at
  `reports/release/v0.7/blocked-a84855f2-schema5-transport-and-parse/`. Schema 5
  will not be rerun. The root cause was the schema-5 tape collapsing four
  extractor attempts with the same request fingerprint into one malformed
  response. Schema 6 restored ordered per-fingerprint response occurrences and
  recorded recovered transport/non-2xx outcomes for exact replay. Its single
  attempt at candidate `4d5e2989` again passed deterministic C1/C40 and 8/8
  scenarios. Baseline provider discovery completed all 233 seed rows with zero
  seed execution failures, but the ordered ledger retained nine unrecovered
  HTTP 503 occurrences across three reranker fingerprints. GurkiAI classified
  the server-side condition as `auth_unavailable` for provider `codex` and
  model `gpt-5.6-terra`; production fallback did not make the provider stage
  valid. The run stopped before candidate discovery or formal replay and is
  archived at
  `reports/release/v0.7/blocked-4d5e2989-schema6-provider-auth-unavailable/`.
  Schema 6 will not be rerun. Schema 7 passed its five provider probes,
  deterministic C1/C40 gates, 8/8 scenarios, and both 233-question discovery
  arms, but disk exhaustion blocked the atomic union-tape write before formal
  replay. It is terminal and archived at
  `reports/release/v0.7/blocked-c5665458-schema7-enospc/`. Schema 8 added the
  4 GiB storage qualification, bounded gzip tape bundle, full-history release
  checkout, and single evidence archive. Its one attempt passed storage,
  provider availability, deterministic C1/C40, 8/8 scenarios, and both
  discovery arms, but baseline formal replay correctly stopped on 76 listwise
  request-body mismatches. It is terminal and archived at
  `reports/release/v0.7/blocked-6f9e5ca0-schema8-sequence-mismatch/`. A local
  provider-free capture reproduced a deterministic mechanism capable of the
  same class of drift: stage-specific seed run IDs entered LoCoMo scope and
  changed candidate selection and/or ordering. Schema 9 removed that confound
  with one shared semantic seed ID across all four provider stages while
  keeping their artifact roots, final IDs, and official IDs separate. Its
  single formal attempt at candidate `21dcac8d` passed the 4 GiB storage check,
  all five provider probes, deterministic C1/C40 protection, and 8/8 scenario
  replay. C1 moved overall evidence recall by `+0.858369pt`, including the
  preregistered research-record movement of `+1.587302pt` for the temporal
  category; C40 moved overall recall by `+0.429185pt`. The provider union tape
  contains 1,023 entries. Each formal arm then reproduced all 1,018 requests
  with 1,018 exact hits, zero misses, zero live requests, zero sequence
  mismatches, and zero execution or judge failures. Provider evidence recall
  and official score deltas were both zero; strict answer score moved by
  `+0.071531pt`. The passing compact artifact now authorizes the fresh full
  1,540-question claim rerun. It does not itself publish v0.7.3: the full claim,
  final strict readiness, tag, npm publish, and GitHub Release are still
  pending.
  See `docs/plans/GoodMemory-v0.7.3-Replacement-Protection-Protocol.md`.
- The Kimi Code plugin is published in `v0.7.2`. A clean macOS acceptance with
  Kimi Code 0.31.1 installed the bare GitHub URL as
  `hjqcan/GoodMemory@tag:v0.7.2`; `/reload` connected one stdio MCP server with
  nine tools. The exact registry command then passed write, new-process recall,
  trace-to-memory-id, and different-`cwd` isolation. A model-driven Kimi write
  approval capture, a second independent clean-machine install, and Windows
  smoke remain unverified; they are adoption/Marketplace gates, not claims of
  completed support.
- Main has completed Phases 68 through 72 on the generalization-first line.
  The production selector graph contains only
  generalized selection primitives, and the `recommended` preset now has a
  provider-free multi-granular BM25/entity/RRF path with an optional dense
  channel.
  The 139-file historical selector closure now lives physically under
  `scripts/eval-profiles/legacy-fitted/`; repo-local historical evals must
  activate that profile explicitly with `bun run test:legacy-fitted`.
- Release packaging is compiled-only: public bins execute `dist/bin` entrypoints,
  and the tarball excludes `src` plus TypeScript bin sources. A release test
  scans compiled JavaScript for known fitted benchmark literals.
- Core public workflow remains centered on `createGoodMemory`, `remember`, `recall`, `buildContext`, `feedback`, `forget`, `exportMemory`, and `deleteAllMemory`; advanced host/operator facades such as runtime, jobs, reviseMemory, and runMaintenance stay explicit.
- Package subpaths `goodmemory`, `goodmemory/ai-sdk`, `goodmemory/host`, `goodmemory/http`, and `goodmemory/runtime-kit` resolve through compiled `dist/` artifacts and emitted type declarations.
- Storage resolution is automatic: explicit config wins, configured Postgres can be used when bootstrap succeeds, Bun gets local SQLite, and unsupported Node zero-config local SQLite falls back to in-memory with observable runtime inspection.
- The official CLI uses the package bin. The global CLI invocation path is `goodmemory ...` after `npm install -g goodmemory`; project-local installs use `npx goodmemory`, `npm exec -- goodmemory`, or `./node_modules/.bin/goodmemory ...`. Non-version command execution remains Bun-backed today.
- Generic live-memory eval semantics are auto-storage aligned: `eval:live-memory`, `eval:live-auto-memory`, `runLiveMemoryEval()`, `eval:live-provider-memory`, and historical `reports/eval/live-memory/phase-*` paths keep their existing meanings.

## 0.7 LanguagePack Stable Release Source

- 0.7 is defined as a clean breaking replacement of the former partial
  language adapter. The target public language surface is one complete
  `LanguagePack` contract with first-class `en`, `zh-Hans`, `zh-Hant`, `ja`,
  `ko`, `fr`, and `es`; there is no adapter compatibility layer or
  half-migrated release mode.
- The Chinese guarantee is script-local. Simplified and Traditional packs keep
  distinct compatibility/analyzer identities; raw user text is not converted,
  OpenCC is not a runtime dependency, and cross-script Chinese lexical recall
  is not a 0.7 acceptance condition. Ambiguous Han-only text uses the
  configured default, while unsupported explicit locales use neutral Unicode
  behavior instead of English semantics.
- Derived search is versioned separately from canonical memory. The 0.7 target
  generation is documents v3, entities v2, claims/status v2, and scope catalog
  v2, with a persistent analyzer/build/source-generation proof. A scope must
  not read a partial new generation; it uses canonical fallback until an
  interruptible, repeatable migration validates and atomically publishes
  complete proof.
- This section records the accepted architecture and immutable release-source
  boundary, not proof that an external registry publication occurred. 0.7 must
  not be tagged or published until its fresh full
  suite, typecheck, coverage, storage/migration/scale gates, real PostgreSQL
  `EXPLAIN` run, Node 20 and Bun packed-consumer smokes, type/release tests, and
  sub-4-MiB package evidence are recorded for one exact source identity. A
  skipped environment-gated PostgreSQL run is not a pass.
- All benchmark scores and package checksums elsewhere in this document remain
  bound to their stated 0.6 or historical source identities. They may not be
  relabeled as 0.7 evidence without a new protocol-bound run.

See ADR-008, `docs/GoodMemory-LanguagePack-Extension-Guide.md`, and
`docs/GoodMemory-0.6-to-0.7-Migration-Guide.md` for the decision, extension,
cutover, and rollback contracts.

## Installed Host And Runtime Surface

- Phase 35 installed host-memory middleware is now part of the accepted stable host surface. Phase 35 is now closed as the installed host-memory middleware and hooks slice. Accepted commands and hooks include `goodmemory setup`, `goodmemory status`, `SessionStart` / `UserPromptSubmit` hooks, and managed Codex/Claude install/enable/disable flows.
- Phase 37 is now closed as the installed host selective writeback slice: `goodmemory codex writeback`, runtime defaults off unless explicitly changed, and new interactive installs recommend `observe`.
- Phase 37.1 is now closed as installed-host writeback productization polish: `goodmemory codex writeback inspect`, audit/undo support, and observe/selective boundaries.
- Phase 38 is now closed as the governed runtime surface slice: `GoodMemoryConfig.observability.traceSink`, targeted `reviseMemory()`, `memory.runtime.*`, `memory.jobs.enqueueRemember()`, `GoodMemoryConfig.providers.embedding`, and `examples/express-chat-server.ts`.
- Phase 39 is now closed as the Python HTTP integration bridge slice. See `docs/GoodMemory-Python-HTTP-Integration-Bridge.md` and `examples/python-fastapi-memory-consumer.py`.
- Phase 41 is now closed as installed-host pre-action unification: `goodmemory codex hook pre-tool-use`, `goodmemory codex action`, and the installed action bridge share the installed memory backend.
- Phase 42 is now closed as the Progressive Recall Protocol slice.
- Phase 43 is now closed as the Runtime Kit slice: `goodmemory/runtime-kit`.
- Phase 43.5 is now closed as the Optional Runtime Worker slice: `goodmemory runtime worker drain-once`.
- Phase 50 is now closed as the Installer CLI Runtime-Shell Hardening slice: `goodmemory doctor [codex|claude|both]` and `goodmemory repair [codex|claude|both]`.
- Phase 51 is now closed as the Typed Behavioral Memory And Enactment slice; typed behavior is stored on compiled `validated_pattern` feedback.
- Phase 52 is now closed as the Structured Text-Response Enactment And Guarded Policy slice; guarded_policy remains internal.
- Phase 71 is now closed as the local memory administration product slice.
  `goodmemory inspector serve` hosts the packaged private React/Vite console and
  versioned `/admin/v1` API for scope discovery, categorized memory, candidate
  review, governed revision/deletion, recall traces, and audit events. Auth is
  Bearer-only after fragment-token bootstrap; mutations require ETags and
  idempotency keys. `goodmemory runtime viewer` is deprecated and delegates to
  the same server in exact-scope read-only mode. See
  `docs/GoodMemory-Inspector-and-Admin-API.md` and
  `reports/quality-gates/phase-71/run-20260711-admin-inspector/`.
- Phase 73 remains active as a separate Codex-only product-effect lane. C0-C2
  are closed. C3's tracked projection is internally accepted as
  source-reproducible frozen-prehistory protocol/host evidence. C4's prior v8
  acceptance is superseded; the canonical v9
  corpus-wide leakage core, independent review, baseline, authenticated raw
  and projected stage evidence, and final readiness are accepted. C5 internal
  pilot `run-c5-pilot-v16-20260721T150112Z` is accepted; C6-C7 remain open.
  C6 has a deterministic preflight/checkpoint implementation, but its candidate
  manifest is not frozen and there is no finalized candidate dataset,
  packaged-Linux host profile, flat-summary corpus, Linux execution, or C6
  result.
  Source-v1, source-v2, the 76,257-byte prior-178 plan, and
  `source-v3-simple` are historical, reproducible, and non-authorizing. The
  source-v3 promotion chain validly granted census-entry authority, but the RF5
  observation on Apple arm64 with Bun 1.3.11 encountered the affected runtime
  liveness incident and was stopped. Its terminal disposition is
  `abandoned-infeasible-observation` and `not-promotable`; the incomplete
  runtime root is diagnostic evidence only. Commit `16bb256a` now rejects
  arm64 Bun versions below 1.3.12 and exact-matches observed Bun and Node
  versions to the frozen runtime. That guard does not repair, resume, or
  promote the stopped observation.
  The bounded successor
  `goodmemory-c6-codex-coding-effect-source-v4-bounded-v1` is now a tracked,
  separate protocol. It exact-replays the 4,497-request repository prefix,
  binds all 9,277 committed attempts, derives all 3,578 PR-target exclusions,
  and selects 16,384 repositories across eight languages. Its 269,523,056-byte
  external snapshot has 12 exact assets plus an asset lock. The latest
  materialization holds the historical v3 writer lock from before source scan
  through a terminal exact source reread and atomic publication; it is
  byte-identical to the earlier snapshot. Positive replay and controlled
  disk/in-memory mutations pass. The first exact source freeze
  `ebe98af07fa747f55eedfa6b312d17f9265dae33` received a real
  fork-without-history review and was rejected; no `R`, `A`, or `P` commit was
  created from it. The rejected receipt exposed a long-gate timeout/cleanup
  race and the lack of an explicit schema-valid rejection branch. Those
  protocol defects were repaired in v2. The next freeze
  `c345e79856e59d98e806d7e6ff12c554a77315bd` was also independently
  rejected: seven of eight checks passed, but one reviewed negative-workflow
  test depended on the working tree being newer than frozen HEAD and failed
  with `nothing to commit`. Its direct negative-review child is
  `06044f11ddb0eafcb59be913199afa37fcdcb7bd`; it grants no authority.
  Commit `a8ca1e3209f6b8beb292348ce7da188a839092fb` repairs the committed-HEAD
  fixture and archives the exact v2 negative receipt. The resulting freeze
  `476347acc257ec599f19ff86aa5c7f48a896ab03` received a new
  fork-without-history review and passed all eight checks. Its direct accepted
  review, bridge-only activation, and receipt-only publication commits are
  `d20675814ca1157b154a9b4c2af79362502d110e`,
  `11e619f3c0516f118f5a835dd48a21046082ddf1`, and
  `9cadc426c28ab1f883434078e8c0870affe61df1`. Publication verification now
  records `sourceSelectionFrozen: true` with an unconsumed capture target.
  This closes source review/publication only; live capture, episode-edge
  construction, relationship qualification, and the independent
  power/precision allocation artifact remain open gates.
  The adjacent-edge preflight is now executable: source-record v5 binds two
  chronology/ancestry receipts per three-stage episode, task-origin review v5
  requires one raw-gold-blind and run-outcome-blind semantic verdict per edge,
  and candidate plan v7 includes the edge set in lineage/episode closure. The
  old per-episode reviewer label is removed; reviewer identity comes only from
  asset-bound review provenance and remains non-cryptographic. The synthetic
  391-episode readiness fixture exercises 782 edges; it is not a real dataset.
  The candidate builder independently rechecks episode-ID, edge/receipt
  identity, and decision-count closures while leaving artifact-byte
  verification to readiness. Focused tests pass 43/43 (1,751 assertions),
  full readiness passes 38/38 (90 assertions), and the source-v3 exact gate
  passes 1/1 (11 assertions).
  GitHub capture authenticity, repository reachability, actual per-edge review,
  evaluator replay, and allocation remain absent, so accepted episodes stay
  zero and no freeze/run claim changes.
  Final C3 run `c3-controlled-20260716-cleanclone-003` used a clean mechanical
  runner snapshot at commit
  `fc31f4f96f3975daea361805da3fc4fc942c5aa4` / tree
  `996b1c24bfb53a9d9c62eb109997576df7b512af`, clean GoodMemory source
  commit `594ee5406ff082f6210d4be4f763f529f13a1a9f` / tree
  `af13dc2688a0e3636f2c2e40728a47eb52ce90eb`, package SHA-256
  `4526fc05ee1fadf05ff80e555827af67477724bf5e0d4cd3613452b899a647c3`,
  Codex CLI 0.144.5, and `gpt-5.6-sol` / `xhigh`. The CLI now rejects
  `/tmp`, `/private/tmp`, `/var/tmp`, and `/private/var/tmp` for every
  sensitive C3 input/output because Codex 0.144.5's macOS platform sandbox
  unconditionally allows those scratch roots. The accepted run used
  non-temporary roots, exact-denied current and cross-arm runtime state,
  direct current/cross-arm auth probes, workspace read/write positive controls,
  and a network-off positive/negative control before both model launches.
  No-memory completed before frozen-prehistory materialization, and both Codex
  processes completed before evaluator materialization. The installed recall
  preflight and current-session canary bound the exact seeded memory, thread,
  sanitized transcript, cursor advancement, committed Stop writeback, and raw
  transcript persistence off. Deterministic hidden fail-to-pass and
  pass-to-pass tests passed in both arms: 2/2 attempts finalized and resolved,
  zero infrastructure failures, one comparable pair, outcome `tie-both-pass`,
  and `publicClaimEligible: false`. The tracked projection under
  `reports/quality-gates/phase-73/c3-controlled-20260716-cleanclone-003/`
  contains 17 bound files. Its independent verifier accepted internal
  consistency and two clean-clone patch replays with no reasons, while
  explicitly recording `externalAuthenticityVerified: false`. C3 is therefore
  accepted for protocol execution and installed-host activation only; the tie
  does not prove coding uplift and does not authorize a public coding-effect
  claim.
  C3 source-reproducibility gate is closed. The supplemental tracked directory
  `reports/quality-gates/phase-73/c3-controlled-20260716-cleanclone-003-source-reproducibility/`
  contains a complete 4,891,617-byte Git bundle with SHA-256
  `86aa767660b30fc9b6930c166c86cd9415d2e0083919e629abbdd9ef1d613ecb`.
  A clean clone from only that bundle reconstructed exact runner commit
  `fc31f4f96f3975daea361805da3fc4fc942c5aa4` / tree
  `996b1c24bfb53a9d9c62eb109997576df7b512af` and ran the bundled historical
  verifier, which again accepted all 17 projected files and both patch replays.
  This closes recoverability, not external authenticity;
  `externalAuthenticityVerified` remains false.
  C4's previous v8 controlled dataset, baseline ceiling pilot, independent
  review, and final readiness are historical and superseded. The schema-v2
  fixture has 6
  episodes, 18 stages, 2 controlled repositories, all 8 required memory
  strata, a 63-file asset lock, 54 stable fresh-base probes, and 18 passing
  fresh gold replays. The complete leakage audit covers 486
  surface-by-hidden-artifact cells. Its 1458 intentional mutation cells cover
  fragment, typed-value, and typed-relation channels; 648 are applicable and
  810 are explicitly not applicable. Relation detection preserves exact
  trim/case endpoints and scans each agent-visible corpus across repository
  relative paths, whitespace, sentence, line-count, byte-length, and
  physical-file boundaries. The frozen
  manifest now explicitly binds public pass-to-pass relations already present
  in visible repository source; undeclared relations split across files are
  rejected. Four content-preserving
  dynamic surfaces remain bound for live C5 re-audit:
  `effective-codex-input-after-seeding`, `flat-summary-after-seeding`,
  `goodmemory-export-after-seeding`, and
  `goodmemory-hook-context-after-seeding`. Core SHA-256
  `6ec596c99891376842e612520ae00b00f627e99ba63f48b9a690f02c06c72d3a`
  binds asset lock
  `a4db88c4dc9ebea7fc464ba104f34c3a0852e2743a798694723d9ae9614606c4`.
  A fresh `fork-turns-none` reviewer inspected only the 63 frozen assets and
  deterministic core before the live baseline existed, accepted all six
  episodes, and explicitly recorded that no coding outcomes were inspected.
  Review SHA-256
  `cfa5b75dc8ad7bc30fc287f05dae113a6af3720e5b3ca806ba1487e38acbf44e`
  and provenance SHA-256
  `1eee28b3fb8f08b5f57dcfb74db62632682145f062d32cad93341c227f54c4dc`
  bind dispatch, request, input bundle, and response, while disclosing that the
  orchestrator attestation is not a cryptographic receipt. Historical v8 baseline
  `run-c4-baseline-v8-20260717T032532Z` finalized all 12 planned no-memory
  stages with 2 resolved, 10 unresolved, zero infrastructure failures, and
  `ceilingRisk: false`; report SHA-256
  `145075fe1db774e14fbce1ba6df6b6170c64cd87a9c81c89a7abb39aefcfb220`
  recorded decision `proceed-to-c5-pilot`. Historical final readiness SHA-256
  `7cf3f8cb829472f34e475dddfe69911651887c2896559712988e1153b6ea0128`
  bound the superseded core, baseline, review, and provenance. The immutable
  v8 artifacts remain at explicit `*-v8` historical paths. Canonical v9 core
  SHA-256
  `420f5c11b1a8aa344714a950b154477449856aed130be37abfe2cdf474eff544`
  and review SHA-256
  `16f63486e39d349b98abfb38340e8492962d8ecf2b78ed488b28e9c4ae439a09`
  bind asset lock
  `795473a2916e441ff9cc39ac92578565a84405ffd45589d90943ad31b81d1195`.
  Baseline `run-c4-baseline-v9-20260718T1815Z` has report SHA-256
  `2140f020a5d3817d4b91a0d8edf5227db6fa7fec32995a6fab12df6d52901270`,
  zero infrastructure failures, no ceiling risk, and decision
  `proceed-to-c5-pilot`. Final readiness SHA-256
  `3b24b4233faa6930d98c4de3d9bfea003ab09225c0eec0c7c81fb9c10869b2e2`
  binds the v9 core, baseline, review, provenance, 12 projected stages, and 12
  authenticated raw sources in one repository-replayable bundle. Those
  artifacts, not this summary prose, are the C4 truth source; the release test
  rejects any routing/status projection that drifts from them. No C4
  version proves coding uplift or authorizes a public coding-effect claim.
  C5 internal run `run-c5-pilot-v16-20260721T150112Z` completed all 72
  scheduled Codex stages and all 36 pairs. Thirty pairs were comparable: the
  GoodMemory arm resolved 28/30 versus 12/30 for no-memory, producing 16
  rescues, zero regressions, and an episode-cluster bootstrap interval of
  0.2667-0.6667 for the 0.5333 net-rescue rate. Six host-canary infrastructure
  failures and six memory-channel failures remain explicitly accounted for;
  the affected pairs are incomparable, not silently scored. The independent
  verifier accepted the 395-file sanitized projection and disclosed 36
  process-only Codex JSONL trajectory-origin receipts whose content preimages
  were not independently observed. A fresh `fork-turns-none` reviewer accepted
  every-attempt accounting, no-silent-fallback, failure taxonomy, power
  analysis, and claim boundary, with that authenticity limitation recorded as
  an advisory. The final C5 gate is accepted at
  `reports/quality-gates/phase-73/c5-native-longitudinal-pilot-v16/`, but
  `externalAuthenticityVerified`, `publicClaimEligible`,
  `publicCodingEffectProof`, and `readmeRowAllowed` remain false. This is a
  positive internal controlled-pilot signal, not public coding-uplift proof;
  C6 expanded evaluation and C7 claim review remain open.
  The implemented C6 checkpoint pins the exact accepted five-file C5 v16
  prerequisite, rejects a symlinked dataset root or ancestor, recursively locks
  candidate bytes and executable modes through non-following file handles, and
  revalidates the complete closure at the end of preflight,
  structurally inspects a gzip archive for the declared `goodmemory`
  name/version/entry closure, performs episode-wide all-stage static leakage
  review, and binds the documented gate policy, the same frozen
  `goodmemory-estimate-text-tokens-v1` counter used by installed-host
  GoodMemory, a local pricing receipt,
  package-only Linux x64 identity, three-arm order balance, and actual
  positions-two-and-later coverage for all 8 memory strata. It derives task
  fingerprints only from the agent-visible repository tree and ordered prompt
  bytes, excluding hidden gold, expected changed files, hidden tests, and
  evaluator metadata; it rejects duplicate visible tasks and requires at least
  48 exclusive `primaryStratum` episodes per stratum, so one multi-label
  episode cannot fill several sampling quotas.
  A canonical source-lineage artifact pins each source revision, population
  manifest, normalized source-record JSONL bytes, per-row index/hash, and
  license-review structure. It covers every episode and ordered stage; binds
  agent-visible task, repository, prompt, snapshot, source request, locator,
  source-snapshot revision, upstream-item revision, prehistory unit list, and
  materialization receipt. Every ordered real-history stage record must match
  its reviewed task-origin locator, `ecmascript-string-trim-v1`
  original-request hash, and item revision. It rejects reused target unit IDs, record bytes,
  locators, or target aliases in prehistory. The candidate plan binds that
  lineage and its per-episode targets. This proves only asset-locked
  normalized-record consistency. It does not authenticate the local capture
  against upstream, reproduce the prehistory artifact, or prove authentic and
  semantically dependent real-history chains.
  The first tracked real source-pool capture now pins the exact SWE-bench
  Multilingual revision `e5c585e008e2cb5eecc7c64192d855c53279d788`,
  1165968-byte Parquet, and 729-byte dataset-card README, then commits all 300
  normalized rows across 41 repositories. Its 333573-byte artifact SHA-256 is
  `15cf8d4a0a7ab0e3e7dee32555f266f1bccfd47ace7f5b31d8e474e064c37cf5`;
  274 rows are queued for origin/relationship review and 26 are mechanically
  rejected. It retains no original problem/gold/test text and treats MIT only
  as the dataset-card license. This is source-pool reproducibility evidence,
  not an accepted C6 dataset: `acceptedEpisodeCount` remains 0 and
  `candidateManifestFrozen` remains false.
  A second real capture pins the exact 17-row Multi-SWE-bench jq JSONL and
  dataset card. Its 25676-byte source-pool artifact SHA-256 is
  `fe513b9810bcc2bee926402c8384a4a0e438dd5ed5495b8d84fe3a4665fe1d4e`;
  four canonical upstream PRs overlap the first source pool, so it adds at
  most 13 new tasks. A paired 700325-byte decision ledger at SHA-256
  `4d0942ec59aa3de906c9c621211d84ae7750d2f3d4f953d65f59fdd00d22154a`
  enumerates all 136 pairs and 680 triples. Two ancestry edges have hash-bound
  local GitHub response captures and one first-base jq license file is
  captured, but those receipts are not independently authenticated or
  reviewed. Every triple remains blocked and unordered; ancestry is not
  semantic dependency, `acceptedEpisodeCount` remains 0, and
  `candidateManifestFrozen` remains false.
  A third Multi-SWE intake artifact makes the next relationship search
  systematic over every `_dataset.jsonl` file no larger than 1000000 bytes in
  the locally merged 59-entry revision-tree capture: 24 files, 9725174 source
  bytes, 261 rows, and 24 repositories. The tracked schema-v2 29589-byte artifact
  SHA-256 is
  `4c7fb407078905f2ad1705f21e617796b31fcca4777cb8fd912e0801f6c20c06`.
  It finds 15 aliases against the first source pool, six cross-record
  pull-body reference signals, six shared-issue ambiguity groups, and exactly
  one mechanically strong relationship candidate. Hash-bound local GitHub
  responses prove only merge/base order `3075 -> 2896 -> 3189`; both ancestry
  edges pass, and all three source rows match the captured pull and
  original-issue text. The third solution PR identifies pull 2896 as
  reintroducing behavior fixed by pull 3075. However, issue and pull creation
  timestamps both order the original work `2896 -> 3075 -> 3189`, so the
  artifact marks a `merge-order-regression` candidate with
  `requestChronologyVerified: false`; it records zero chronological-request
  candidates and cannot enter the current real-history claim set. This is
  evaluator-only discovery evidence, not a frozen agent request or accepted
  episode. The locally merged tree body lacks response headers and independent
  pagination authentication; the public-API captures lack independent
  authentication; repository reachability/tree proof, semantic and duplicate
  review, cross-stage gold/leakage review, Linux replay, and full Multi-SWE
  coverage are absent. `acceptedEpisodeCount` remains 0 and
  `candidateManifestFrozen` remains false.
  A fourth tracked intake increment scans all 39 exact Multi-SWE files no
  larger than 15000000 bytes in that same local tree receipt: 561 source rows,
  561 canonical PR anchors, 2244 local GitHub API response-body files, and
  complete before/after byte-and-mode closure revalidation for both local
  roots. The 876631-byte artifact SHA-256 is
  `afe795834113e1b859783948d2977511e77d6126563d6c5f481385d085a3b076`.
  It records 39 strict timestamp-only review/fix heuristic signals, 90 anchors
  with two request-like review events but no matching heuristic sequence, 430
  with fewer than two such events, and two unresolved repository-identity
  redirects. Inline review history is anchored to `original_commit_id`, while
  the mutable `commit_id` is retained separately. This is deliberately not an
  upper bound and cannot decide whether the 48-real-history quota is feasible:
  the local captures omit issue/PR discussion comments, request and response
  headers, and verifiable pagination closure. Platform authenticity,
  commit ancestry, semantic dependency, replay, license review, and
  independent intake acceptance remain absent. The artifact therefore keeps
  `acceptedEpisodeCount: 0`, `candidateManifestFrozen: false`, and
  `feasibilityConclusion:
  not-estimable-from-partial-review-signal-surface`.
  A fifth discovery-only increment closes the captured source and API surface
  over all 47 Multi-SWE `_dataset.jsonl` files: 1764624161 source bytes, 1737
  rows, 47 repositories, and 1737 canonical PR anchors. The current
  two-page, 38412-byte Hugging Face tree body is tracked separately from the
  older 38112-byte receipt and has SHA-256
  `8de0f6501c0fa3dd844d38704a4a44eb8f3b4aaa997aa74c9507c79d501c8384`.
  All 1737 GraphQL captures replay; 45 explicit repository redirects are
  bound. Two first-100 commit gaps are completed by strict 114- and 141-commit
  REST supplements whose base/head and commit prefix match GraphQL. The
  2645700-byte tracked inventory has SHA-256
  `14c406f6bb9d4b8c789380b62511bd1312dd67819eaeb44d64c9ea54593bed51`,
  and its Phase-73 gate rebuilds it byte-for-byte from the external raw roots
  and rejects overwrite. This closes discovery inventory, not dataset intake:
  the 1.76 GB source and GitHub captures remain non-vendored, HTTPS capture is
  not a cryptographic platform receipt, and no row has repository replay,
  fail/pass hidden tests, license review, semantic acceptance, or independent
  intake acceptance. The inventory therefore keeps
  `acceptedEpisodeCount: 0`, `candidateManifestFrozen: false`,
  `codexRunReady: false`, and forbids an upper-bound claim.
  A sixth discovery increment replays the review-trajectory surface for all
  175 preliminary targets against strict REST closure. It has 160 complete
  REST/GraphQL commit closures, 15 missing closures, 156 targets with at least
  two non-author request events, 148 timestamp sequences, and 146 sequences
  satisfying the original three parent-graph constraints. A stricter linear
  rule also requires the second reviewed commit to descend from the first fix
  and both reviewed commits to predate their review events. 145 sequences pass;
  79 have non-empty fail-to-pass signals and 76 have both fail-to-pass and
  pass-to-pass signals. `mui/material-ui#25259` is the only three-edge signal
  rejected by the linear rule because its second review points to a stale
  commit preceding the first fix. Full search still recovers six valid
  branches that the earlier timestamp-first diagnostic skipped. The
  76 strongest rows are highly concentrated across only 12 raw upstream
  repositories: 30 are from `mui/material-ui`, 16 from `sveltejs/svelte`, and
  15 from `cli/cli`. Those top three contribute 61/76 = 80.26%, the largest
  contributes 39.47%, and the size-concentration equivalent-count diagnostic
  is about 4.07. These are allocation warnings, not an effective independent-
  repository count or a post-hoc threshold.
  The
  2568475-byte tracked artifact has
  SHA-256
  `5931a911b919a9c53068311185f0bd1c78c0be18220ebe92c3b795c8e38357fd`;
  its Phase-73 gate rebuilds it byte-for-byte from the external source,
  GraphQL, and REST roots and rejects overwrite. A separate read-only audit
  reconstructed the commit DAG directly from `matchedCommits`, reproduced
  160 strict closures, 146 three-edge signals, 145 linear signals, and the
  sole `146 -> 145` rejection without trusting the stored validity flags.
  These remain post-discovery trajectory signals, not preregistered episodes.
  The source revision is still a declared label rather than a tree-receipt
  binding, HTTPS is not a cryptographic platform receipt, and no signal yet
  has exact repository snapshots, per-stage hidden fail-before/pass-after
  replay, license review, semantic independence review, or gold-blind intake.
  The artifact therefore keeps `acceptedEpisodeCount: 0`,
  `candidateManifestFrozen: false`, and `codexRunReady: false`.
  A separate deterministic audit-order projection replays that exact
  `5931a911...57fd` input and retains all 145 linear signals across 22
  repositories. It ranks only lineage-visible fields, caps each repository at
  four signals, retains a 54-signal capped pool, and marks the first 48 as
  priority seeds across 20 repositories. The tracked projection SHA-256 is
  `938ffaff2d185b3e3ba5d0ccf8e97f626879ffe0c7c44d65f6c6313958a06044`;
  its Phase-73 gate reproduces the complete 145-row decision closure. The
  largest priority allocation is 4/48 and the Kish concentration diagnostic is
  approximately 14.96. These 48 rows are only an outcome-field-independent
  audit order: target availability has not been checked, no final exclusion
  set has been defined, personnel outcome blindness is not claimed, and they
  are not episodes.
  A transition-qualification intake now exact-binds that audit order and the
  `5931a911...57fd` trajectory artifact, preserving all 54 capped candidates
  in `cappedPoolRank` order (48 priority plus 6 reserve). It freezes the
  required three-stage transition evidence plus episode-wide
  repository/license/authenticity/independent-review closure without
  fabricating any result. Only 22/54 candidates contain any final-source
  fail-to-pass signal and 19/54 contain both final-source fail-to-pass and
  pass-to-pass signals; within the priority 48, those counts are 20 and 17.
  These are availability hints, not transition evaluators. The tracked
  projection SHA-256 is
  `59136d44da3f5687afe08cffbed98f0eae71a114389114cb422b73680c1185f8`;
  its unit suite passes 6/6 with 35 assertions and its replay gate passes 1/1.
  It truthfully records zero machine-qualified and zero independently accepted
  episodes, `datasetAssemblyAllowed: false`, and
  `candidateManifestFrozen: false`. The 48 priority seeds therefore cannot be
  counted as the required 48 real-history episodes.
  A schema-v3 rank-prefix semantic-screening ledger now starts the actual
  gold-blind audit in that frozen order. It exact-binds the qualification
  projection at
  `59136d44da3f5687afe08cffbed98f0eae71a114389114cb422b73680c1185f8`
  and trajectory projection at
  `5931a911b919a9c53068311185f0bd1c78c0be18220ebe92c3b795c8e38357fd`;
  the current working-tree ledger SHA-256 is
  `35a5ebc83da5a6ac4c3bc799d6d7484d7fc89e049b5ddb3e8b9ee752c9cc4796`.
  It rejects omission or reordering inside the assessed capped-rank prefix,
  binds each exact `review` versus `review-comment` source event, transition,
  and body hash, and binds a separate reviewer receipt and normalized-
  assessment hash to each candidate. Forty-two ranks are assessed: ranks
  1-4, 6-13, 15-18, 20-29, 31, and 33-42 are semantically rejected by at
  least one later review stage, while rank 5, `fmtlib/fmt#974`, rank 14,
  `vuejs/core#9213`, rank 19, `clap-rs/clap#2796`, and rank 30,
  `fmtlib/fmt#2310`, and rank 32, `tokio-rs/tokio#5343`, are later-stage
  continuations only. Schema v3 still cannot promote them to machine-
  qualification candidates. The
  rejected stages cover
  style/refactor/release-note/documentation-only requests, already-passing
  behavior, ambiguous requests, and target/fix mismatches. Rank 13,
  `simdjson/simdjson#1667`, is rejected because its third target and selected
  fix are documentation-only. Rank 14's three frozen requests and direct
  descendant fixes respectively force a full slot/fallback diff, unmount the
  old vnode instead of reusing it, and remove extra custom-element renderer
  behavior. Rank 15, `sveltejs/svelte#12560`, is rejected because stage 2's
  selected fix closes a different review request and stage 3 only requests
  rationale while its selected fix changes documentation. Rank 16,
  `cli/cli#9083`, is rejected because stage 2 is bound to an unrelated
  upstream merge; the requested remote-selection behavior lands only in the
  following commit. Rank 17, `sveltejs/svelte#13850`, is rejected because its
  stage-2 request and selected fix only reclassify and reword changeset
  metadata; they do not define an executable coding transition. Rank 18,
  `anuraghazra/github-readme-stats#2099`, is rejected because stage 2 only
  requests README formatting and its selected fix changes one markup line.
  Rank 20, `sveltejs/svelte#12413`, is rejected because stage 2 requests
  concrete `$state.frozen` runtime behavior but its selected transition is an
  unrelated main-branch merge. Rank 21, `google/gson#1787`, is rejected
  because stage 2 has no concrete executable request and stage 3 only requests
  a JUnit-version test-style change. Rank 19's two later requests are
  executable clap test-behavior changes and align with their selected fixes.
  Rank 22, `vuejs/core#10416`, is rejected because its later requests are a
  test-only type refinement and an explanatory comment. Rank 23,
  `tokio-rs/tokio#6618`, is rejected because its test-migration request is
  paired with a production-code/features transition. Rank 24,
  `tokio-rs/tokio#6409`, is rejected because its third review only observes
  documentation inconsistency. Rank 25, `detekt/detekt#7635`, is rejected
  because its second review refers to two absent thoughts and is not a
  self-contained coding request. Rank 26, `facebook/zstd#1726`, is rejected
  because stage 2 requests a bounded `srcSizeHint` library/CCtxParams parameter
  and dictionary/parameter selection while the selected transition only moves
  pledged-size handling in `programs/fileio.c`; stage 3 asks to keep
  `contentSizeFlag` enabled while its selected transition only removes unused
  source-size plumbing and does not implement that request. Rank 27,
  `vuejs/core#8470`, is rejected because stage 2 only corrects `entends` to
  `extends` in a test name; stage 1 is behavioral and stage 3's Node/browser
  parse-compatibility request aligns with its selected production transition,
  but the typo-only middle stage is not a behavioral coding task. Rank 28,
  `vuejs/core#10522`, is rejected because stage 3 only renames a test with
  clearer CSS terminology; its scoped-CSS task and stage-2 fixture correction
  are behavioral and aligned, but the terminology-only final stage is not.
  Rank 29, `fasterxml/jackson-databind#3851`, is rejected because stage 2 asks
  for a separate synchronized method while its selected transition instead
  introduces inline `AtomicReference` compare-and-set logic; stage 3's
  get-before-create request and transition do align. Rank 30's later requests
  respectively make width apply to non-finite values without zero fill and
  preserve explicitly requested alignment; both selected transitions align.
  Rank 31, `fmtlib/fmt#3863`, is rejected because stage 2 only removes a
  redundant include and stage 3 only restructures parser control flow with an
  early return and switch; neither later stage requests observable behavior.
  Rank 32's later stages respectively define a 1000-iteration randomized
  `Sender::len` pass/fail test and equal aggregate receive/send probabilities;
  both selected test transitions align.
  Rank 33, `ponylang/ponyc#3819`, is rejected because stages 2 and 3 only
  request release-note/documentation wording changes; stage 3's selected
  transition instead inlines an `AmbientAuth` expression in an example.
  Rank 34, `ponylang/ponyc#3675`, is rejected because stage 3 only requests
  Markdown line wrapping; its memory-safety task and zero-allocation stage 2
  are behavioral and aligned.
  Rank 35, `simdjson/simdjson#1695`, is rejected because stage 3 is only
  praise plus a reviewer-owned documentation follow-up, not a self-contained
  coding request; stages 1 and 2 are behavioral and aligned.
  Rank 36, `ponylang/ponyc#4299`, is rejected because stage 2 requests
  diagnostic regression assertions while its transition only changes
  production diagnostics, and stage 3 is release-note wording only. The
  fail-closed validator caught and prevented an initial GraphQL-timestamp
  target from replacing the frozen REST/linear-ancestry stage-3 target; a
  fresh isolated review binds the corrected target.
  Rank 37, `simdjson/simdjson#1615`, is rejected because stage 2 only explains
  exception-free C++ context without requesting a change; its original JSON
  Pointer task and stage-3 explicit error-code propagation are behavioral and
  aligned.
  Rank 38, `tokio-rs/tokio#6345`, is rejected because stage 3 only corrects a
  documentation link; its owned-inner error behavior and public error-type
  rename are behavioral and aligned.
  Rank 39, `Hannah-Sten/TeXiFy-IDEA#3128`, is rejected because stage 3 gives
  concrete cases but explicitly permits leaving the behavior unchanged and
  offers its quick-fix idea only tentatively. A reviewer correction also
  preserved the schema rule that unbound stage 1 cannot claim transition
  mismatch.
  Rank 40, `tokio-rs/tracing#1983`, is rejected because stage 2 requests
  integration tests for `EnvFilter`'s `Filter` implementation while its
  selected transition only feature-gates the existing implementation and
  adds no tests; stage 3 is unused-variable clippy cleanup only.
  Rank 41, `elastic/logstash#14058`, is rejected because stage 3 requests a
  behavioral distinction between dropped and discarded DLQ events, while its
  selected transition only changes logging and leaves both paths in the same
  counter exposed as `discarded_events`.
  Rank 42, `elastic/logstash#13880`, is rejected because stage 3 requests
  user-facing guidance to use the bundled JDK, while its selected transition
  changes no warning diagnostic and instead adjusts no-JDK packaging plus
  cleanup/debug output.
  Rank 5's three
  requests respectively add
  terminal-color behavior, separate RGB from terminal-color representation,
  and replace assertion failure with catchable `format_error`; those requests
  align semantically with their selected after-commits.
  The protocol correction now defines
  `resolved-issues-only-sorted-lf-trim-v1`: source PR title/body are
  evaluator-only and cannot enter the agent-visible prompt. Three exact
  continuation prompts are now materialized in a 11006-byte projection at
  SHA-256
  `b5babf8bab47c2005b20a0dba731252fc3cbb1f9612216152f7e0e13cdd4692d`.
  The projection retains normalized resolved-issue records, re-derives every
  prompt and issue-record hash, and replays byte-for-byte from the three exact
  local source files. The local downloads and HTTPS observations are not
  authenticated upstream, so
  `externalSourceCaptureAuthenticated: false` remains explicit. A separate
  3317-byte gold-blind stage-1 semantic-review receipt at SHA-256
  `d3c274149a1b2f7a5c04ff96fd560b91f424733fb90aa0d3534cf78767584f2d`
  accepts all three prompts as behavioral requests against reviewed public
  commit ancestry. That receipt is self-attested, not cryptographic, and
  keeps `stage1TransitionQualificationBound: false`.
  Schema v3 has not incorporated this separate projection/receipt, so the
  ledger itself still records `agentVisiblePromptProjectionCount: 0`,
  `stage1AgentVisibleRequestsBound: false`, and
  `machineQualificationCandidateCount: 0`. An independently checked draft
  rank-14 leakage receipt was deleted because it incorrectly treated the PR
  solution body as the stage-1 prompt and did not bind the alleged future
  target bytes. The separate three-prompt projection predates ranks 30 and 32,
  so neither has an exact stage-1 prompt projection or semantic-review receipt
  yet. Stage 1 also has `beforeCommit: null` by contract, so mutable GitHub pull
  `base.sha` is diagnostic-only and historical base/ancestry is deferred to
  machine qualification. A different aggregation of later commits cannot
  replace frozen target/fix bindings after review. Rank 43 is next in the
  prefix, but frame v2 is now structurally insufficient and requires a
  prospective expansion before it can support a 48-episode allocation. Each
  reviewer receipt records explicit no-access declarations for raw gold,
  outcomes, and hidden evaluators, and rank 13 truthfully records its actual
  bounded `fork-turns-3` context rather than rewriting it as no fork. This is
  screening-only, not authenticated qualification or acceptance:
  `cryptographicReceipt` is false, machine-qualified and accepted counts
  remain zero, and dataset assembly and candidate freeze remain forbidden.
  The semantic suite passes 6/6 with 16 assertions and its explicit gate
  passes 1/1.
  The rank-5 continuation has a current working-tree fail-closed transition-
  evaluator screening receipt; rank 14 has not yet reached that step. Its
  asset-lock SHA-256 is
  `a9455232d26beeec738f647969506e248542dde4a6cb8d7405d270287aedeff0`,
  asset root is
  `8a73c28419fe230e15130068a836d7c1e0043b1144aee94128eea43a5e2e369b`,
  and evidence SHA-256 is
  `5235b39c9bffd688a62e384edf77c9ae165c7c9d898bb2ea83d821a74e1c12f8`.
  It binds the rank-5 semantic assessment, evaluator sources, exact
  commit/tree snapshots, six retained raw Git commit objects, Linux/amd64
  image digest, result logs, and protection logs. The validator recomputes
  each retained Git object ID and commit-to-tree mapping. It derives stage 1
  as fail-before/pass-after but rejects the candidate because stage 2's
  selected after snapshot does not compile for a normal public-header
  consumer and stage 3 throws from `noexcept` and terminates instead of
  exposing catchable `format_error`. The stored non-ancestry value is not
  independently authenticated and is no longer a rejection reason. The
  repository protection slice reports 13/13 at the relevant snapshots, but
  excludes `format-test` and is not a native Linux-x64-complete suite. The
  logs are retained and asset-locked, but the local Docker executor is not
  authenticated and the source repository archive is not retained.
  A separate read-only reviewer accepted only this frozen-receipt rejection
  derivation. Its receipt SHA-256 is
  `70db5d33a9f165973107c2349ab5f9487ff239c76655451535690d7b59ffebaf`,
  receipt-lock SHA-256 is
  `a7770e4d1c7dd6b7fd9bb17f3822e1e0e985018ceee16f66ca52d5380430f7a2`,
  and receipt asset root is
  `7671e327880434cef13fd4d02dfe2bd83a5e540991012dd8076c58f8bbe63421`.
  It explicitly keeps reviewer identity, original execution, and local probe
  execution unauthenticated and does not qualify or accept the episode.
  Thirty-seven semantic rejections plus the rank-5 machine rejection now leave
  at most 16 of the original 54 candidates, so that fixed pool is impossible.
  A separate expanded screening frame preserves those 54 rows byte-for-byte
  as its prefix and appends all 91 previously deferred rows in frozen
  `eligibleRank` order. Its artifact SHA-256 is
  `751929cc423d0ad132cbb5d5841a442242b9d59ab713406f352424a33c22def9`;
  its metadata-independent candidate projection SHA-256 is
  `f2875d922dc5aef657363660b9efd0b39799923cbd8068f84ef921791da2e47e`.
  The gate chains the upstream trajectory-to-selection replay, derives
  rejection IDs from the exact semantic ledger object validated by the review
  receipt, enforces the repository-cap/first-48 selector, and rejects
  reordered or forged candidate closures. The expansion policy was selected
  after the rank-12 closure, while the current artifact metadata was refreshed
  after rank 13; temporal order is explicitly not cryptographically attested.
  Given the current 38 definitive rejections, the 145-row frame has only 107
  remaining rows, a conditional repository-capped maximum of 35, and margin
  -13. It can no longer meet the 48-episode minimum.
  A prospective v2 expansion therefore freezes a new structural rule without
  changing the old frame or reading the semantic ledger. The exact inventory
  contains 1,737 upstream rows; all 145 old canonical pulls are excluded,
  leaving 1,592 prospective rows. Full GraphQL replay yields 51 broad
  structural pretargets across 13 repositories, two separately retained
  pagination-unsupported rows, and a pre-REST repository-capped ceiling of
  26. The expansion artifact SHA-256 is
  `629acdc312e611e066d181dacfb1206448c2a3f885921b99eff036159439317f`;
  the policy SHA-256 is
  `b51613368026c09ad1aab3e4d08fe19197ddc1beea9499c9d8e068830527703a`.
  A separate all-51 capture plan at SHA-256
  `6de24fb5e71aed98341cd1f529645cf6d53826ce77bb8ff3ddeb105197860cbc`
  was frozen before network capture.
  The strict REST pass produced 36 exact local closures and retained 15
  missing closures as infrastructure failures rather than semantic
  rejections. Its asset root is
  `eacf953f250d1ce652a85248aabec863555f4849bdb789f4c4be22fcbc460ff9`.
  Author-aware replay then yields 29 exact structural candidates, seven
  captured rows with no exact sequence, and the same 15 missing closures. The
  qualification artifact SHA-256 is
  `256f267868303faf9e4fc4745508efaa023a241cb96d5bfac1a2c4a3aebfc5da`;
  its v2-only repository-capped ceiling is 23.
  A final combined structural frame appends those 29 candidates after the
  complete old 145-row order; it does not insert them after the known rejected
  prefix. Its artifact SHA-256 is
  `7d44dd550f0921d8fa561fde0a6338f9b34afb076b182d05d76181ef4dcb6290`,
  candidate projection SHA-256 is
  `0deafb438d2618a232aa0dd9b5981a6df2b189b48bc1753d03dbaa01b4ffa6b9`,
  and exact-v2 projection SHA-256 is
  `28a3687c6341f6e67c26f5cbc21dc1d5fe49e0a327db89a7bfd55139c27a2606`.
  Before rejection binding, 174 structural candidates across 23 repositories
  have a capped ceiling of 61 and margin 13. Binding the 37 semantic
  rejections plus rank-5 machine rejection separately leaves 136 candidates,
  a capped ceiling of 44, and margin -4. This v1 frame can no longer meet the
  minimum and remains only conditional
  structural capacity: capture-attempt completeness is unproven, all accepted
  and machine-qualified counts remain zero, the manifest remains unfrozen,
  and the observed semantic yield makes further source expansion prudent
  before expensive machine qualification or Codex calls.
  A bounded REST identity supplement now closes the 15 infrastructure gaps
  needed by the structural policy without relabelling them as full REST
  closures. Its frozen plan SHA-256 is
  `72dcc45d43978cdda255937bd9773fb4f4685b7ac862416143dc1d777c97bfb6`;
  the hardened-path 15/15 recapture asset root is
  `26e14cad198c2b12b71c9ecd4c77231447cd53ef6210e391ec6f24a841e53615`.
  Capture rejects token reflection before writing, rejects an existing output
  before any request, publishes through a no-replace tree, and compares the
  pre- and post-publication asset locks. GraphQL-history plus REST-identity
  replay yields 44 exact structural candidates, seven no-sequence rows, zero
  missing identity closures, and a v2-only capped ceiling of 26. Qualification
  v2 SHA-256 is
  `e11752f957a3a8de992866ef2d83a36710a3e9134f5c84728100d67d5c87e0f3`.
  The recapture changed mutable raw response bytes and manifest hashes but
  reproduced the same structural-candidate projection.
  It explicitly keeps
  `originalFullRestCaptureAttemptCompletenessProven: false` while proving
  `pullIdentitySupplementClosureComplete: true`; the local bearer session is
  not a cryptographic platform-authentication receipt.
  An append-only frame transition then preserves all 174 prior candidates and
  ranks, and appends only the 15 newly exact supplement rows at ranks 175-189
  by their frozen original capture order. Frame v2 SHA-256 is
  `9afc398b3475d5f4f6ab016c8fa36df80ed74880971acad789b54cbf4fcc022e`;
  full candidate projection SHA-256 is
  `7b6499bfc62ad8a6c3fce9f26028bcd62354f4c3c4d86acc91e1deca5fe0c992`;
  supplement-delta projection SHA-256 is
  `efb86b1827955d67eb61e79a7e25a9707f5992c304be74603cb55c9295b34229`.
  Its counts distinguish 15 still-missing full REST closures from zero
  missing required identity closures. The 189-row frame spans 25 repositories
  with capped ceiling 63 and margin 15. Applying the 37 semantic-ledger
  rejections plus the separately receipt-supported rank-5 machine rejection
  only in the derived capacity check leaves 151 candidates across 19
  repositories, capped ceiling 47, and margin -1. The qualification and frame
  replay gates pass 1/1 with 6 and 11 assertions. Frame v2 therefore cannot
  supply the required 48 episodes; a new prospective, outcome-independent
  source expansion is required. This remains structural evidence only:
  accepted and
  machine-qualified counts are zero, the candidate manifest is not frozen,
  semantic and transition qualification of the new rows have not run, and no
  Codex coding-effect result exists.
  A tracked `sharkdp/fd#546` evaluator canary then exposed a protocol-level
  blocker. Its asset-lock SHA-256 is
  `d1f87de8146cf05903bf83d5ebf3dd7c93e403f0ef625207e0d7e4288afbe2db`,
  its asset root is
  `b13f088c33b7a1862257d8b5521bcb3dcff9078b019a2e385e4148e876c077d9`,
  and its evidence projection is
  `b304af5ad2733aa05bb36d8ac7066bc93ab51bfeaca54d8d3cbb22f2a5846749`.
  The exact Linux/amd64 image replay observes the base at 167/0, test-only
  and initial-plus-test at 167/1, and gold-, first-fix-, and
  final-fix-plus-test at 168/0. Thus the final Multi-SWE hidden test fails on
  the initial reviewed state and passes after the first fix, but it also
  passes before and after the second fix. The static Phase-73 gate proves the
  frozen projection and derives `sourceUnitReplayEligible: true`,
  `threeStageEpisodeEligible: false`, and
  `stageSpecificEvaluatorRequired: true`. The persisted artifact contains no
  raw execution witness and does not authenticate the local Docker daemon, so
  it records rather than independently proves that the live replay occurred.
  Therefore a final-PR evaluator cannot score both review transitions. More
  generally, one episode-level sealed prehistory cannot represent a growing
  `original task -> review 1 -> review 2` history without either omitting
  required prior context or leaking later history into earlier stages. C6 must
  freeze a stage-scoped sealed-prefix protocol and transition-specific
  evaluators before any review trajectory can be promoted. Every stage must
  still rebuild from upstream-frozen history shared across arms; experimental
  arm output may not carry into a later stage. Until that clean protocol
  replacement is implemented and replayed, the current 48 priority seeds
  remain triage inputs only.
  The stage-scoped clean break is now integrated through deterministic
  preflight: dataset schema v3
  moves the frozen-history binding onto every stage; the stage-prefix helper
  rejects reordered, removed, duplicated, or target-contaminated source
  units; lineage schema v2 loads each actual history artifact and binds its
  ordered source units, materialization, target record, and stage/episode
  closure hashes, while rejecting drift in the actual history JSONL prefix;
  and gate-policy v4 freezes
  `rebuild-from-stage-sealed-prefix`. Leakage now audits each stage against its
  own exact JSONL prefix,
  all later-prefix suffix records, all future prompts, and the episode-wide
  hidden/gold/evaluator closure. Flat-summary protocol/artifact schema v3
  binds one audited output to an exact non-empty episode/stage/history tuple
  and uses the same frozen estimator on both arms' final injected text.
  Candidate-plan schema v7 binds per-stage history, lineage, target, snapshot,
  adjacent-task relationships, and input closures, rejects
  `persistent-branch` carryover, and rejects
  legacy episode-level contracts. It admits only a primary cohort of exactly
  391 `real-history` or `external-benchmark` episodes with exactly three stages
  each, including at least 48 real-history episodes, and rejects controlled
  mutations from the primary dataset and 10,557-call schedule. Oversized
  episode, stage, and declared-budget mutations now fail rather than silently
  increasing the run to 10,584 or 10,566 calls. Controlled mutations are
  separately reported diagnostic evidence only and are not counted as though
  their external registry were consumed by the candidate plan. A no-history
  stage requires canonical
  zero-byte history and zero source units, invokes no provider, writes no
  summary artifact, and gives both treatment arms an explicit
  `no-history-zero-injection` receipt. The production ceiling is therefore up
  to 1173 non-empty stage-history bindings; the actual count is derived after
  dataset freeze. Readiness, CLI, and the end-to-end fixture now consume these
  contracts. Focused candidate/gate validation passes 22/22 with 1674
  assertions, the real frozen-input power suite passes 6/6 with 18 assertions,
  and typecheck passes; broader current-tree counts must be refreshed after the
  downstream replay completes. This
  completes readiness-ladder step 1 only and proves deterministic
  byte/count/hash closure, not semantic reconstruction, source authenticity,
  an accepted dataset, or coding uplift.
  The preflight accepts a `real-history` episode only when its strict
  asset-locked source
  record binds the original-request hash, repository URL/base commit, HTTPS
  source locator and immutable revision, and exact agent-visible candidate
  `taskContentSha256`. Per-episode receipts are accepted only as asset-bound
  review-receipt structure. A dataset-level canonical
  request/input/dispatch/response/provenance envelope hash-binds all
  real-history records and rejects an author/reviewer collision, but explicitly
  records that it has no cryptographic platform receipt; independent
  authenticity remains required before candidate freeze.
  A separate schema-v2 five-file intake-review validator cross-checks the
  caller-reconstructed candidate universe, origin anchors/families, and
  deterministic representatives. Representatives must be selected or
  qualified-reserve, non-representatives must be semantic duplicates, selected
  IDs must equal the final dataset IDs, and the reserve set must be complete.
  It deliberately reports `selectionClosureRebuilt: false`,
  `sourceIntakeClosureRebuilt: false`, and `cryptographicReceipt: false`; it is
  review-envelope structure until an independent verifier rebuilds both
  closures.
  A static package-closure validator now cross-binds an externally frozen
  asset root, closure, lockfile, GoodMemory archive, offline dependency
  tarballs, installed tree, and declared Linux x64 runtime profile. It rejects
  archive-path escape, dependency-graph gaps, missing or substituted packages,
  and self-consistent root replacement. It deliberately reports
  `buildReceiptValidation: declared-profile-structure-only` and
  `linuxRebuildProven: false` when used without a live executor.
  The separate materializer has now run twice from fresh output roots against
  image
  `420f9c50e115184234e0e355d8a9ffed8b49c1b8512972ec9a8a402bb259834f`.
  Both executions performed empty-cache, network-disabled `npm ci --offline`,
  a second frozen-closure rebuild, and read-only CLI smoke, and produced
  byte-identical 124-file closures. The expected identity is
  `770d7a80938a62c86914e863e639c20e63358fc0fc56afb99f2823f212179c30`
  and installed-tree hash is
  `c73a5db06353bd0dc8c0a31e2a3837e8636eca6e4d59f221df338b1acf0dc3eb`.
  The tracked 1173473-byte projection is bound by
  `two-run-reproducibility.json` SHA-256
  `3a066d1e841f9902bb499a60715feba3bbac6cc9feca0bf3d376e7503d6ab0cd`;
  the two full 57233374-byte roots remain external. Persisted verification
  intentionally returns `linuxRebuildProven: false` because the JSON receipt
  has no raw execution witness; the explicit gate revalidates both external
  roots without promoting that structure into cryptographic execution proof.
  The exact Git source has also been rebuilt in two independent pinned-Linux
  containers. Commit `5d6dab3bf8b406455068c01863c5cbd51cf65756` and tree
  `8563c9136864430772e024925811be55402f3372` produce source archive
  `9a45c0d9d4a06b54586a6d8321a96e2a781d6f9c316d5bb4405aad6b6d1f9c37`;
  both builds produce the frozen package
  `5f9b98600ff024a80a7a337fa8953e162b7498bf909a67e8b217a9bba5dd2757`.
  Receipt SHA-256 is
  `230948d69f433600e31e239944d19b76bde1282d6ddd390212f0d298aed57e16`,
  and the 499308-byte tracked projection has SHA-256
  `16360426083d7ee2d79cb89ee90880edc4276e24e5c5c35ce09b1c2bcfaa14bc`.
  This remains a networked source-build diagnostic: it records
  `sourceBuildReproducible: false`, `networkDisabled: false`, and no external
  attestation. The 39223537-byte full closure remains external. An offline
  frozen dev-dependency source build or equivalent independent attestation is
  still required before source-to-archive proof can close.
  A historical v3 run completed two same-host source builds in fresh
  pinned-Linux, network-none containers from two independently materialized
  copies of one frozen dev-dependency closure. Both installed 292 dependencies
  and produced the same 1035700-byte package at
  `5f9b98600ff024a80a7a337fa8953e162b7498bf909a67e8b217a9bba5dd2757`.
  Its external nine-file root is
  `/private/tmp/goodmemory-c6-package-source-offline-v3-sync-v1`; receipt
  SHA-256 is
  `21599cb09660c944cf759a6f97e1e9ed1cb15ca35d619b088c104d92c5deb732`
  and runner-source root is
  `047e3939016d0ba646139354edad44902008183f8e0d3078ed0ab104547f4826`.
  The external-root Phase-73 gate passes 2/2 with 14 assertions. This is a
  local two-run offline observation plus static replay. The dependency-cache
  scanner now uses synchronous exact FD reads with per-chunk monotonic
  deadlines and unconditional closure; its focused suite passes 11/11 with
  141 assertions. This is termination/integrity hardening, not an authenticated
  witness.
  That historical receipt remains unauthenticated:
  `sourceBuildReproducible`,
  `c6PackageOfflineClosureProven`, `executionAuthenticated`,
  `externalIndependentAttestation`, and `rawExecutionWitnessIncluded` remain
  false.
  On 2026-07-31 the same public dependency acquisition was reconstructed and
  frozen at
  `/Users/hjqcan/workspace/GoodMemory-c6-runtime/package-source-dependency-current-v1/dependency-closure`.
  Its asset-lock, asset-root, cache archive, content-root, and manifest hashes
  exactly reproduce the historical frozen values:
  `69529d6d911b28f9ce4b85b001fb568eaa4eec0521298c8d74c141db205d2840`,
  `b3d7578afb15853626a11069f11ff22e8a3b836bf4097f460cf67f9b28f5f3e9`,
  `c75e3b005846d33ee95f0efde5d3d088beffca0dbffe9dd3678735de41980d17`,
  `baf131784dfb3cb9e9d086bf55f8068e463b0b00aa087a3b758057389fa66a80`,
  and
  `9e73f357b9e2ef1e618bb1edce42ab2edd9685699a492b19514b331b19f8dd8c`.
  A fresh current-runner materialization at
  `/Users/hjqcan/workspace/GoodMemory-c6-runtime/package-source-offline-current-v1`
  then performed two fresh Linux/amd64, network-none builds. Each installed
  292 dependencies and produced the same 1035700-byte package at
  `5f9b98600ff024a80a7a337fa8953e162b7498bf909a67e8b217a9bba5dd2757`.
  Receipt SHA-256 is
  `94c1bdb4cb0c7390683dc7692242733a0883856f5be1c2a10e1977f9bdff8066`;
  current nine-file runner-source root is
  `5a05bff089c75a3f726c3a0c371e052a25896b13bdcccb9b96b0d2ce5b05b241`,
  and runner protocol SHA-256 is
  `94e43195e193f1c591287202ebfb643355496835b7703d32d5b76469b29f3389`.
  The current external-root Phase-73 gate passes 2/2 with 14 assertions; the
  dependency-closure, source-reproducibility, and CLI unit slice passes 31/31
  with 329 assertions. No materializer container or temporary publication root
  remained after the run.
  This closes current-runner drift only. The fresh receipt still records
  `sourceBuildReproducible: false`,
  `c6PackageOfflineClosureProven: false`,
  `executionAuthenticated: false`,
  `externalIndependentAttestation: false`, and
  `rawExecutionWitnessIncluded: false`. The full evidence roots remain local
  and external to Git. Authenticated source-to-archive proof and C6-T003
  therefore remain open.
  The Codex side now has both a static closure and a formal two-run
  materialization for `@openai/codex@0.145.0`. The exact package/lock,
  registry capture, main tarball, Linux x64 optional tarball, optional-
  dependency graph, executable bytes/modes, and installed tree are
  cross-bound. Two fresh, read-only, network-none Linux/amd64 containers each
  performed the offline install and returned `codex-cli 0.145.0`; their
  8339-byte run artifacts are byte-identical at SHA-256
  `31dc6b7ca5babf01d6bcff7e012a63aaf12f1e1141b4e44dfea7ea01e997463b`,
  with installed-tree SHA-256
  `f4dd92f92e35501f547e76be3e9f916d4b701ac28d78a533c89337dcd0d4e39a`.
  The tracked nine-file closure is rooted at receipt SHA-256
  `c5301d9ae73447b9ab78ba3e4c2575dd76c831af6701244e00db5602ea9fc0df`
  and asset-root SHA-256
  `66884e8b6152694f7ab941916dc2d33f225640fee2ff40c1de19378a15a2ff91`;
  its Phase-73 gate verifies the retained projection and can revalidate it
  against the external tarball root. The live orchestrator observed both
  installs, but the persisted JSON is not a cryptographically authenticated
  execution witness. It therefore intentionally preserves
  `persistedLinuxOfflineInstallProven: false`,
  `linuxOfflineInstallProven: false`, and `codexRunReady: false`. This closes
  the bounded Codex package-install materialization step, not the
  installed-host profile, treatment injection, dataset replay, or coding-
  effect run.
  The archive inspection is not package-source or runtime-function proof, the
  visible-input fingerprints are not semantic-independence proof, and the
  local pricing receipt is not independent price-source proof. Summary
  artifacts for non-empty histories recompute
  injection size from the exact output with the same GoodMemory token estimator
  instead of accepting a caller-declared count. The deterministic receipt
  helper also freezes and hashes flat-summary's verbatim no-wrapper final text
  and GoodMemory's installed-host `additionalContext` final text composition,
  but it is not connected to the runner and does not yet prove event-placement
  parity. The packaged-Linux profile must recover the exact ordered native hook
  events and segments, bind each segment's content hash and token count plus
  the ordered composition hash, and freeze equivalent flat-summary placement
  and per-event caps; if the exact native composition cannot be recovered, the
  pair is incomparable. Final packaged-Linux per-stage injection receipts and
  authenticated raw provider generation receipts are still required
  before run identity or Codex execution. No-history stages are canonical
  zero-byte/zero-source-unit inputs and generate no summary or provider
  request; both treatment arms inject zero text. C5's reported 113 episodes /
  339 stages / 2034 two-arm calls were powered over all three stage positions;
  they do not establish the C6 headline budget for positions two and later.
  A structural installed-host checksum helper now reads the retained
  source-v2/package/Codex receipts and validates their internal relationships
  plus ordered hook-event metadata. Its real public path is currently red:
  current source-runner root
  `5a05bff089c75a3f726c3a0c371e052a25896b13bdcccb9b96b0d2ce5b05b241`
  differs from retained root
  `e18b9b7ce6c7929deb20c5aa3ca394d3a779f23bfb69055b21907f2bd3d2f84f`.
  The helper explicitly leaves final composition bytes, flat-summary
  placement parity, execution authentication, independent witness,
  installed-host proof, and run readiness false. Focused replay passes 5/5
  and an independent rereview found no P0-P3 inside that narrow structural
  boundary. It is not C6-T003 evidence.
  A separate local request-placement canary now combines the frozen
  GoodMemory and Codex 0.145.0 package closures in two fresh pinned Linux x64,
  network-none containers. Eight real Codex loopback Responses requests verify
  exact SessionStart/UserPromptSubmit placement, native Stop behavior,
  installed recommended-profile composition, mirrored-hook, hooks-disabled,
  and frozen flat-summary-hook controls, transport-only normalization, and
  two-run semantic stability. The flat control reads one exact no-wrapper
  output from the read-only runner mount, binds its 45-token bytes to separate
  1024/512 event receipts with the shared token counter, and reproduces the
  GoodMemory placement geometry. It is not provider-generated corpus material.
  Cleanup authority is narrower than execution acceptance, every create
  attempt must prove zero remaining candidates before roots are deleted, and
  terminal source/input checks plus exclusive publication happen only after
  cleanup. The current-runner wrapper binds the frozen package/image/Codex
  identities, exact 512/1024 profile, flat control, and transport preimage,
  rejecting stale but internally self-consistent v7/v8 artifacts.
  The external-only v9 diagnostic is 488782 bytes at SHA-256
  `3ba8c0d57e5f5a39ef723939a9063e4aed6c7c2fbd68e70ea056c0a60abd3b0a`;
  its frozen, two observed, and current runner identities are all
  `2cf3e767852cc3d4d056e7b152c6b2028501e025833c64145f9a8a24959e2dc1`.
  Both verifiers pass and no retained container or temporary root remains.
  Independent read-only consistency review found no P0/P1. Focused
  runner/verifier/CLI replay passes 18/18 with 130 assertions and typecheck
  passes; synchronized package, image, Codex tarball/version, GoodMemory
  version, and 512/1024 budget mutations fail closed. The prior full canonical
  suite was interrupted without a terminal result and is not green evidence.
  The v9 file is only a `/private/tmp` runtime diagnostic: it is not tracked,
  asset-locked, authenticated, or externally attested, and its flat summary is
  a frozen local canary rather than the final 391-item corpus. All nine
  promotion boundaries remain false, including C6-T003 completion, final
  installed-host profile, flat-summary parity, and Codex-run readiness.
  `flatSummaryHookProjectionStructurallyBound: true` is local structural
  placement evidence only.
  A structural flat-summary corpus protocol now separates one receipt per
  distinct non-empty generation input from every per-stage, per-seed binding
  that reuses its output. Exact-set verification rejects missing, extra,
  duplicate, no-history, wrong-history/key, and cross-seed-output drift.
  Readiness can expose structural counts, but it still reports zero
  authenticated generation receipts and false provider authenticity,
  candidate-manifest freeze, and Codex-run readiness. The focused replay is
  74/74 with typecheck green. No canonical corpus or authenticated provider
  execution exists, so this is not C6-T002 completion.
  The next injected-transport checkpoint binds the exact GurkiAI endpoint,
  frozen request/prompt/history/protocol, code-unit request order, and the raw
  observed `$.model`. HTTP 200 is not success until JSON, shape, usage, model,
  and the shared final-text budget pass; rejected 200 attempts retain their
  raw bytes/hash, retry sequence, and canonical manifest. No-history remains
  zero calls, and token-reflecting responses are rejected without retaining
  the token. Independent review found no P0-P3 inside this structural boundary
  and passed 50/50 focused tests with 1848 assertions; the wider local C6
  replay passed 105/105 with 2391 assertions and typecheck. No live request or
  corpus materialization occurred. Provider/TLS identity, pricing, leakage,
  asset-lock, external witness, canonical corpus, stage-artifact binding, and
  installed-host placement parity remain absent, so this is still not
  C6-T002 completion.
  A subsequent publication/finalization checkpoint adds a direct exact-mode
  CLI, durable claim-before-provider ordering, append-only raw/decision/
  accepted/terminal evidence, receipt-last publication, and zero-network
  `--finalize-only` recovery. The verifier re-derives frozen request bytes,
  attempt reachability, status/decision classification, raw-to-normalized
  output and usage, provider artifacts, corpus/index bindings, and canonical
  paths before terminally replaying the receipt, root, and strict feature-local
  asset closure. Crash recovery retains partial provider bytes as
  process-interruption evidence and never redispatches. Live transport freezes
  one 300-second deadline and a streamed 4 MiB cap; token validation plus raw
  and decoded secret scans run before sensitive publication.
  Two independent read-only reviews found no remaining P0/P1 in this offline
  boundary. Pinned-Bun focused replay passes 46/46 with 237 assertions, the
  legacy/frozen-source regression slice passes 9/9 with 67 assertions, and
  typecheck/diff checks pass. The full Phase 73 gate was attempted but is not
  green: historical C3 replay also fails on unmodified `main`, while several
  explicit external capture roots are unavailable. A convenience
  `package.json` alias that initially drifted frozen source-v3 evidence was
  removed and both affected source-v3 gates then passed targeted rerun. No live
  request, authenticated provider identity, canonical 391-summary corpus, or
  installed-host placement proof exists. Provider authenticity,
  candidate-manifest freeze, and Codex-run readiness therefore remain false;
  this still is not C6-T002 completion.
  Reusing C5's all-stage correlation would produce an unaccepted mechanical
  131-episode estimate. A tracked schema-v2 eligible-position recalculation now
  binds the exact frozen C5 v16 report, plan, pairs, attempts, stage
  executions, and projection manifest at SHA-256
  `7c0ce1f26af3540fc84359db10500e9e9bc04b4186e80a87ca3bbc3174ac4b72`.
  It validates the stage-position memory semantics and materializes
  byte-identically from the retained projection. A fresh
  `fork-turns-none` reviewer independently replayed all six inputs and returned
  `ACCEPT_WITH_BOUNDARIES` with no P0-P2; the only filename/schema P3 was
  closed by a byte-preserving rename. The separate review receipt SHA-256 is
  `3f8292aba907acf947148c925d61e7698312177f25fdf521b634106efbafd918`.
  It is not cryptographically authenticated and supports no floor reduction,
  candidate-capacity assertion, C6 outcome inference, or public claim. C6
  therefore continues to fail closed at the worst-case
  within-episode correlation: 391 episodes, 1173 scored stages, 7038
  no-memory-plus-GoodMemory Codex calls, 10557 total three-arm Codex calls, and
  up to 1173 one-time stage-history summary generations. Identical
  stage-history hashes may reuse one summary, but distinct growing prefixes
  may not share an episode-level summary. The 391 value is now explicitly
  `minimumEpisodeFloor`, not a sufficient final sample size: C5 did not
  estimate between-repository heterogeneity, and adding episodes from the same
  few repositories cannot manufacture independent repository evidence.
  The stage-scoped gate-policy schema is version 4. It freezes
  `rebuild-from-stage-sealed-prefix` and gives every episode equal
  primary weight, demotes the old episode-only bootstrap to diagnostic-only,
  restricts the primary coding cohort to real-history/external-benchmark, and
  makes controlled mutations separately reported diagnostic-only evidence,
  freezes canonical upstream repository-family clusters, and requires a
  10,000-sample repository-then-episode hierarchical bootstrap, a separate
  equal-repository estimand, and a complete leave-one-repository-out influence
  table. A repository-robust superiority claim requires the predeclared point
  delta, positive hierarchical lower bounds for both episode-weighted and
  repository-equal statistics, and a positive delta after omitting every
  repository. Non-inferiority applies the same three checks against the frozen
  negative margin. No outcome-blind, independently reviewed repository
  allocation/power artifact exists yet, so candidate freeze and full Codex
  execution remain blocked. If an eventual episode-weighted result passes but
  repository sensitivity does not, the only allowed wording is improvement
  on the frozen episode-weighted benchmark mixture; cross-repository or
  general coding-effect wording remains forbidden.
  The preparation command deliberately terminates at
  `preflight-accepted-freeze-prerequisites-required`, with
  `candidateManifestFrozen: false` and `codexRunReady: false`. Before any
  candidate freeze it still requires authenticated package source-to-archive evidence,
  repository URL/commit/snapshot and license receipts, and an independent
  relationship/intake-selection and semantic-duplicate review. Before summary
  generation it also requires the
  exact packaged Linux GoodMemory profile/config and actual injection-token
  receipts needed to establish an equal summary budget and equivalent ordered
  injection placement. The corrected protocol requires every GoodMemory
  stage/seed to rebuild from that stage's upstream-frozen sealed prefix.
  Prefixes may grow across historical stages, but no state or output from an
  experimental arm carries into another stage, seed, or arm. Stop/writeback
  remains host-integrity evidence and the store is discarded. Independent
  pricing review remains mandatory for the cost branch. The prior
  episode-level prehistory implementation and tests are superseded evidence.
  Corrected dataset, lineage, summary, leakage, candidate-plan, gate-policy,
  readiness, CLI, and end-to-end contracts complete deterministic readiness
  step 1. Steps 2 through 10 remain open: the accepted episode count is zero;
  the multi-repository controlled-mutation registry can now replay its
  mechanical closure twice but deliberately accepts zero diagnostic episodes;
  there is no 391-row primary real-history/external-benchmark supply, frozen
  391-episode dataset, authenticated summary corpus, final installed-host
  profile, 10557-call execution, frozen statistical report, C7 independent
  gate, outcome, or README/public coding-effect claim. C6-T001a now supplies a
  real MIT-licensed `unjs/defu` canary pinned to commit
  `82632b66f5914e9946edce300e10633a3d5c0cb7` and tree
  `f98fd0ecb1056fb087f117a97241a433309f087c`: two semantic families, one
  cosmetic duplicate, a six-file source-only projection, frozen
  repository-family identity, exact-outcome clone rejection, corpus-wide
  direct prompt-leakage checks, and content-hashed evaluator execution
  bundles. Its Linux receipt SHA is
  `b084eda0c425925947644e59f9c86495743d381c5ab19e728bc9b6712211c60b`;
  two pinned-image runs share closure
  `383247fa598266ca00ff45d8f79cc336e845e36c75df54afe63cd53a0ff126cd`,
  and the explicit gate passes locally and under pinned Linux/amd64. This is
  deliberately not an accepted episode: semantic equivalence review is false,
  evaluator dependency closure is unfrozen, network isolation and execution
  authenticity are unattested, full upstream CI was not run, no sealed Codex
  mount exists, and both candidate freeze and Codex readiness remain false.
  A later actor-correction checkpoint supersedes the prior structural
  frame-v4 candidate truth without rewriting it. Frozen current GitHub actor
  receipts are applied to every raw review/comment author before thread-head
  and legal-sequence selection. The three corrected qualification artifacts
  have SHA-256
  `69e6417308279fb398cdec5abdf7b41e77d501097830264a502175815e8e98f8`,
  `7fb942cd87126d360ed820e91cf8bee1073153cd21c674eeb91d3cb09b05929f`,
  and
  `728453138ee33e6b6e5525ea6e3555c998d9f17774afed8da18c8ff845283a66`.
  Their new prospective-only frame is
  `6838de7f36875b3b3de104ffd896b9e30dcf95ad1eb285a87b465789800f4b0c`
  with candidate projection
  `1d0c5689521aa906e7fb2bf015579bbcc7638b31093966edec5339724aec82af`:
  113 structural candidates, 57 repositories, and repository-cap-4 ceiling
  93. The explicit replay gate passes 1/1 with 18 assertions on the current
  external roots. This is only a current-platform-User filter, not human or
  event-time identity proof, and the roots are not repo-contained. More
  importantly, cap 93 is 298 below the 391-episode headline floor (the raw
  count is 278 short and is independently insufficient). Cap 4 is only the
  current screening-diversity diagnostic; final repository allocation still
  needs the separately reviewed outcome-blind power/precision artifact. The
  artifact therefore says
  `headlineRawStructuralCandidateFloorMet: false`, zero
  accepted/machine-qualified
  episodes, `candidateManifestFrozen: false`, and `codexRunReady: false`.
  The old 42-row semantic ledger is not reused; its rank 43 is not the next
  actor-qualified screening action.
  The next supply action is frozen prospectively as the Live/MultiLang
  neighbor-census plan at SHA-256
  `1b07d57ebc5601b9ab7f6742fdb5da91b9181784d7b2a33bf28ad318fa2e10f1`.
  It reconstructs 743 anchors, 381 requested repositories, and 380 canonical
  repositories; excludes the 37 current-frame overlaps; and selects 64 unused
  repositories as eight per language split in rotated rank order. A cap of 16
  merged PRs per repository produces a 1024-anchor query ceiling, not 1024
  candidates. Its 5/5 focused tests pass with 14 assertions and the real
  external-closure rebuild is byte-identical. The metadata-only capture is now
  complete: completion SHA-256
  `68727cb0aefb04a3f9b84f8e67a41f9aaba952665e2fef798f61110e36352b53`
  binds 1024 raw anchors across all 64 repositories; every repository history
  is explicitly truncated at the frozen newest-16 cap. The external 257-file
  root SHA-256 is
  `79d7d23097ec1ee11082a7b01a8f36d59383b3e2cf5d536630b29fde7a9400c4`.
  Qualification SHA-256
  `e51243ea3aa740a3a0812f8c1289ac2d3cf51436440ae0ecfea67a280743f1cc`
  byte-replays both the source plan from its frozen source pool and the
  neighbor plan from its frozen actor frame, rejects untracked initial or
  terminal root entries, rebuilds the 743 old anchors, removes three overlaps,
  and reports 1021 novel pulls: 692 review-surface deep-capture pretargets and
  329 with no review surface. Its deep-target projection is
  `f45d9ef61b55d73d2b94c8018d7874ae58887fa01133a4fd77883f0548701404`.
  Independent rereview accepted qualification v2 with no P0/P1, and its
  external-root quality gate passes 3/3 with 14 assertions.
  The bound 692-target deep-capture plan is SHA-256
  `9c1ebdafd700a274cffc4dba807a2425013079d1bfe74a1e99f1144399da492a`;
  independent review accepted the plan with no P0/P1/P2, and one real initial
  GraphQL query completed without schema error. The full 692-target paginated
  network execution remains pending. This remains a merged-only, newest-16,
  adaptive convenience sample using post-merge structural counts. Deep review
  closure, actor, machine, and semantic qualification and accepted counts
  remain zero.
  The historical 841,425-byte source-v1 and 631,004-byte source-v2 proposals
  retain their exact hashes and gates for audit. The historical
  `source-v3-simple` protocol exact-binds source-v2 SHA-256
  `822c458e792ee31f7738cae2526b05dfc3b63fcaac58e3f4f87dcd3803ccdba1`
  and the inherited source-frame projection SHA-256
  `efb76e58585c6c422020954783eee50e37290d94f78310bd88c176929fa85474`.
  Its contract required every one of the 1,536 shards and every in-window
  merged PR to enter the complete ledger; processing order could not change
  membership.
  Two source-v3-specific prior-identity observations now cover 356 successful
  lookups each, with 356 unique request IDs per observation, zero cross-set
  intersection, and agreement on all 178 repository node IDs and alias-dedup
  rows. Their 4,769-byte replay receipt SHA-256 is
  `903912db14ed999cd19f32ffaef81658bc241daf8be9e2f33aa14b1784b94d0a`.
  A fork-none local replay review produced response SHA-256
  `b71f659284b477b85d3cb7fd19912774b8f72b953f9b543966ced1f795e0a740`
  and non-cryptographic provenance SHA-256
  `14ac08a41e2fbcc4bc0cc8a33409d6a029951fd6b61c8f50457a0395394b228e`.
  The complete bundles are preserved as two portable archives
  (`5fe5a4c2...7120`, `4a04936a...5b10`) under manifest
  `3add09d0...1dec`; a fresh process replayed them without the original
  `/private/tmp` roots. This proves durable local byte closure, not external
  authenticity or independent network provenance.
  The historical promotion gate implementation passes 11/11 with 45
  assertions. It binds
  committed protocol/review/portable bytes, the promotion CLI and verifier
  sources, dependency locks, raw Git object view, strict freeze-to-activation
  ancestry, generation HEAD, and F/I/base/HEAD/runtime equality. Its exact
  activation entrypoint is dynamically imported and verifies the published
  receipt; at promotion time it granted only permission to enter census. The
  one-parent freeze
  is `ba4cee1e668adff0354b23dd743ae44e23e42af9`; the strict descendant
  activation and promotion base is
  `cc42f0bbd673b6595a6c82b3c5cb995a8efbe826`. The 12,652-byte receipt at
  `fixtures/codex-coding-effect/c6-source-pool/provenance/source-v3-simple/promotion/promotion-receipt-v1.json`
  has SHA-256
  `a0892b9c87cce89b23604a43b02d06ad1344fe010afd4894a5f6c387c7d43e3b`.
  As a historical promotion snapshot it verifies
  `priorRepositoryNodeIdExclusionComplete: true`,
  `sourceV3SimpleFrozen: true`, and `formalCensusPermitted: true`, while
  retaining `candidateManifestFrozen: false`,
  `candidateSelectionPermitted: false`, and `codexRunReady: false`.
  The later RF5 observation on Apple arm64 with Bun 1.3.11 encountered the
  affected runtime liveness incident and was stopped with terminal disposition
  `abandoned-infeasible-observation` and `not-promotable`. Commit `16bb256a`
  rejects arm64 Bun below 1.3.12 and exact-matches observed and frozen Bun/Node
  versions; this is a runtime safety and provenance guard, not new promotion
  authority.
  The stopped observation contains a complete repository-phase prefix with
  4,497 logical requests, 191,612 repository rows, and 191,604 rows after the
  historical prior exclusions. The bounded successor
  `goodmemory-c6-codex-coding-effect-source-v4-bounded-v1` now exact-binds that
  prefix plus all 9,277 committed attempts, derives 3,578 PR-targeted
  repository exclusions, and deterministically selects 2,048 repositories for
  each of eight languages (16,384 total) without replacement. The external
  canonical selection snapshot contains 12 assets plus `asset-lock.json`,
  occupies 269,523,056 bytes, and has asset-lock SHA-256
  `73ccd3d157a1ea3e211c72be80f88c4891d08909226e95cf1011e65e37c3c3a9`.
  Its prefix, pilot-exclusion, and selection receipt SHA-256 values are
  `fe6791ea6d94ae35ac706c49867a5b54a4bcf5289f2c88f3941611ad771851e6`,
  `20a80aedbd4492b1e8e83d5d3fda8ca9fc82b3b230b79666b68ef141a3523084`,
  and `733bd7e3473164d48a4419fcd59d66f33b6c198807935cae0d6ea9a3a2704305`.
  The source transaction takes the same writer lock used by the historical v3
  runner before scanning, holds it while writing, replays the complete exact
  v3 source again immediately before publication, and releases it only after
  atomic rename and verified reload. The resulting v1/v2 snapshot directories
  are byte-identical. Every committed logical completion is also replayed
  through the original v3 evidence verifier, including attempt, response,
  retry-decision, and projected-result identity; response values are verified
  for integrity but are not selector inputs. A verified in-memory snapshot is
  revalidated against its receipt chain, manifest, asset lock, and byte count
  whenever a capture plan is built. The initially loaded asset identity is also
  retained in a private `WeakMap`, and the returned ordinary object/array graph
  is deeply frozen, so self-consistent hash rewrites, cohort writes, copied
  brands, and accessor substitutions cannot create a second identity between
  verification and plan construction. The transport collector is not an
  exported API. The focused v4/Bun unit slice passes 29/29 with 135 assertions.
  The pinned Bun 1.3.12 snapshot gate passes 5/5 with 21 assertions, including
  request substitution, manifest drift, extra-file mutations after rebuilding
  the asset lock, same-language in-memory cohort substitution, asset-identity
  rewrites, and accessor substitution. The runtime liveness gate separately
  exact-binds Bun binary SHA-256
  `39e644cea4e6db24a3af36013695655d6f789b4b98f1f13bacb882ac6e5c3c18`
  and executing child-source SHA-256
  `019cde93809a7cf052b33a965d562a7b8466726766dbf28ccfa8d1ba66b9ce90`,
  uses per-seed challenge-bound canonical records capped at 16 KiB, ignores
  child output streams, preserves partial operation counts in a failed result,
  and imposes a bounded post-kill reap. It passes 1/1
  with 18 assertions across three seeds, 100,000 work items and 700,000
  filesystem promise operations per seed.
  The source-side review and activation protocol is now implemented and has
  been exercised once as an actual rejected review, but never as an accepted
  review or capture. It requires an exact
  one-parent freeze `F`, a direct child `R` that adds only five canonical
  review artifacts, a direct child `A` that adds only the capture bridge, and a
  direct child `P` that adds only the activation receipt. The receipt itself
  retains `liveCaptureAuthorized: false`; only exact `P` publication
  verification, a fresh pinned Bun liveness run, clean-worktree and frozen-path
  rechecks, and an unused host-local target derive one opaque in-process
  capture capability. Git observations use the exact `/usr/bin/git` binary
  with SHA-256
  `7588ceab299393618d6f8861502ac0588d1594025f301d9a61a898215b5571d3`,
  reject replacement/graft/alternate object views, and repeat lineage,
  worktree, target, and closure checks immediately before the create-only
  claim.
  The fixed bridge is a shell launcher that replaces the environment through
  `/usr/bin/env -i` and starts the exact pinned Bun with `/dev/null` config,
  env-file loading, auto-install, and native addons disabled. The direct worker
  accepts only that exact argument vector, its own exact entrypoint, and an
  empty or token-only environment. Live execution and its CLI are
  module-private, and every GraphQL request explicitly uses the pinned
  runtime's non-writable, non-configurable native `Bun.fetch`; the capture path
  never resolves mutable `globalThis.fetch`.
  A claimed capture cannot be retried or topped up. Pre-completion errors write
  a strict failure terminal and asset lock; if only evidence finalization
  fails after logical requests finish, `--finalize-only` can seal the existing
  success or failure terminal without reading a token or issuing another live
  request. Historical verification requires exactly one strict terminal,
  strict-parses and binds `capture-claim.json`, binds the terminal receipt SHA
  and failure publication commit, and for success also binds the
  normalized-capture bytes, selected repository/identity closure,
  per-repository page counts, logical request count, and recomputed projection
  hash. A success terminal is insufficient by itself: the verifier scans the
  exact `pass-A` durable request/attempt/completion chain, rejects an
  incomplete trailing request or any pass-root entry outside the exact
  directory/completion/result triplet for every contiguous ordinal, binds the
  final completion tip, replays every projected result through the frozen
  capture plan, and requires deep equality with the normalized artifact.
  Default unit tests now construct the exact v3 frame from tracked bytes
  without Git history; the real historical commit authorization remains an
  explicit Phase-73 gate. The current focused v4/liveness unit slice passes
  46/46 with 199 assertions.
  The F/R/A/P mutation gate creates its accepted response in-process, so it
  proves schema, topology, snapshot/liveness, one-shot claim, failure sealing,
  finalize-only recovery, and mutation rejection only. It is not independent
  review evidence. The repaired pinned-Bun replay passes 1/1 with 26 assertions
  in 376.50 seconds under its 720-second budget. The separate real snapshot
  mutation gate passes 5/5 with 21 assertions in 104.89 seconds, and the
  three-seed liveness gate passes 1/1 with 18 assertions in 9.04 seconds. The
  review bundle binds 74 source/gate/test paths, eight
  required checks, and the complete relative TypeScript import closure from
  every reviewed TypeScript root.
  The first real freeze was commit
  `ebe98af07fa747f55eedfa6b312d17f9265dae33`, tree
  `092bc045f335287fb894be5996565fe301aff313`, with direct parent
  `3b0ba2d13fc53a8a71b034342bf16c78b5e1507a`. Fresh reviewer task
  `/root/c6_source_v4_bounded_review_v1` independently verified the 72-path
  v1 closure, snapshot selection, liveness, focused units, and typecheck, but
  rejected the freeze after the integrated gate exceeded 420 seconds and its
  framework cleanup raced the still-running operation. It also correctly
  identified that v1 could express rejection only by becoming
  schema-invalid. The exact dispatch/input/request/response bytes are retained
  under
  `reports/quality-gates/phase-73/c6-source-v4-bounded-review-rejected-ebe98af/`;
  response SHA-256 is
  `ed0705f32f0aa7e0328476b64d49bb82b0219864275002c4cb8e9f9ee3a7bfe0`.
  No provenance, reviewed `R`, activation `A`, or publication `P` was created
  from that freeze.
  Review protocol v2 is a clean break: accepted and rejected responses are a
  discriminated union, a valid rejection has at least one blocking finding
  and grants no authority, the provenance recorder can preserve that negative
  receipt, and activation explicitly rejects it. The comprehensive gate now
  gives each operation one exact temporary root and removes it only after that
  operation settles; no test-hook cleanup can race a live promise. These are
  protocol-repair results, not an accepted review.
  The v2 freeze `c345e79856e59d98e806d7e6ff12c554a77315bd`, tree
  `948419c89c5141bf9c3e7eecd779e33e8e9d9cf1`, received a fresh
  fork-without-history review. The independent reviewer passed the real
  snapshot mutation gate (5/5, 21 assertions, 105.90s), three-seed liveness
  gate (1/1, 6.11s), historical preflight (1/1, 8 assertions, 5.63s), and the
  integrated topology/mutation gate (1/1, 26 assertions, 427.62s). It still
  rejected the freeze because the reviewed unit slice was 40 pass / 1 fail:
  the negative-review workflow cloned frozen HEAD, recopied identical sources,
  and required a non-empty repair commit, so Git stopped at
  `nothing to commit` before the activation-blocking assertion.
  The schema-valid response SHA-256 is
  `f00111d63bd3e943380ca441008e0a672b60316eab1782bcdd6877f29274da47`;
  provenance SHA-256 is
  `086dca356590b4c274839bc14c8480e13424efa176584d8000e049444d5527ef`.
  Direct review child `06044f11ddb0eafcb59be913199afa37fcdcb7bd`
  records `decision: rejected` and `independentReviewAccepted: false`.
  Its exact five review artifacts are archived under
  `reports/quality-gates/phase-73/c6-source-v4-bounded-review-rejected-c345e798/`.
  Commit `a8ca1e3209f6b8beb292348ce7da188a839092fb` makes the fixture's
  synthetic freeze commit explicitly allow an identical tree. On that
  committed state, the reviewer's exact unit slice passes 41/41 with 170
  assertions, the broader v4/liveness slice passes 46/46 with 199 assertions,
  and typecheck passes.
  A different fresh reviewer then accepted freeze
  `476347acc257ec599f19ff86aa5c7f48a896ab03`, tree
  `a134a14892be1acc4f5c22813edf1619be771515`, after independently matching
  all 74 reviewed paths and the complete snapshot/selection closure. Its
  reviewed unit slice passed 41/41 with 170 assertions, real snapshot mutation
  passed 5/5 with 21 assertions in 83.61 seconds, integrated topology/mutation
  passed 1/1 with 26 assertions in 303.29 seconds, liveness and historical
  preflight passed, and pinned-Bun typecheck passed. The accepted response
  SHA-256 is
  `49ad96a6c1b50d2532439f99f17220376343d6ad1f1ee158876f6b684f147dfa`;
  provenance SHA-256 is
  `6a31d36a1cb37295864a92e6a37404253c8d70b433142b38b10a3cd9224acc53`.
  Direct child `d20675814ca1157b154a9b4c2af79362502d110e` adds exactly the
  five accepted review artifacts. Direct child
  `11e619f3c0516f118f5a835dd48a21046082ddf1` adds only the exact
  687-byte bridge, and direct child
  `9cadc426c28ab1f883434078e8c0870affe61df1` adds only the activation
  receipt. Receipt SHA-256 is
  `9a33926467e01d351d84196a7aeecf23a20ae2ca5930b7cb77c9980afc788455`.
  Read-only publication verification reports
  `independentReviewAccepted: true`, `sourceSelectionFrozen: true`, and
  capture state `unconsumed`; the durable receipt deliberately retains
  `liveCaptureAuthorized: false`, `candidateManifestFrozen: false`, and
  `codexRunReady: false`. The dedicated GitHub token is not present in the
  current host environment, so the one irreversible capture has not started.
  The one-shot scope is
  the canonical published `P` and its bound host-local target; it is not a
  cryptographic global lock against an author creating a different publication
  fork, so later scientific artifacts must pin the one canonical `P`.
  The clean worker closes the concrete in-process transport-substitution path,
  but GitHub API responses are not third-party-signed attestations; provenance
  still depends on the reviewed canonical worker, pinned host/runtime, raw
  ledger, and reproducible replay.
  A separate unpinned default-suite diagnostic on the shared checkout is not
  green: 6,060 passed, 52 skipped, and 15 failed across 710 files. The failures
  were six expected Bun-1.3.11 early guards, one existing five-second timeout,
  and eight tests whose external reviewer-identity fixture was absent. This is
  neither a successful repository regression gate nor evidence that the v2
  source protocol failed; the frozen review uses its exact pinned gates and
  isolated typecheck instead.
  This proves materialized selection plus accepted review/publication and
  `sourceSelectionFrozen: true`. The capture is still unconsumed, and no
  durable artifact claims live authority. No frozen 391-episode dataset,
  authenticated summary corpus, 10,557-call execution, frozen statistical
  report, C7 gate, or Codex run exists.
  After synchronizing the frozen controlled-mutation asset reader and
  rematerializing its receipt in the exact pinned Linux/amd64 image, the
  canonical repository suite passes 5938 tests with 17 skips, 0 failures,
  50726 assertions, and 13 snapshots across 678 files. This is repository
  regression evidence only; it does not change any C6 dataset, execution, or
  claim gate.
  `c6-repository-statistics.ts` is only a tested primitive until it
  is wired to the complete attempt loader, frozen report, independent replay,
  and C7 gate.
- The Phase 72 benchmark gate and versioned release gate are closed evidence for
  `v0.6.0`. Because `v0.7.0` changed LanguagePack and recall semantics, the
  current-claim table is empty until fresh `v0.7.2` runs pass the strict gate.
  The five prior declarations remain versioned historical/internal rows.
  LoCoMo covers all 1540 non-adversarial questions with zero execution/judge
  failures and scores 0.6298701299 strict, 0.8707792208 under the independent
  `gpt-5.5` official protocol, and 59/96 = 0.6145833333 on open-domain.
  MemoryAgentBench uses deterministic judge-free scoring and reports CR
  0.9589041096 and TTL 0.9333333333 versus no-memory 0.000; AR/LRU remain
  excluded.

  BEAM 100K (unified 0.7651 / strict 0.620 / recall 0.8276) is retained as
  historical `v0.6.0` generalized evidence. The run disables all 148 narrow recall
  gates and legacy fitted answer postprocessing, covers all 400 questions and
  1051 rubric items, and has zero execution/judge failures. The independent
  unified score is 0.7650987103 versus the public same-protocol 0.49 reference;
  strict binary remains disclosed at 248/400 = 0.620 and the upstream paper
  score at 0.7510180808. The frozen event-ordering audit found 7/40 cases with
  non-chronological official evidence order plus one requested-item/rubric
  mismatch. Therefore 0.72 strict and 0.80 unified remain disclosed stretch
  diagnostics, while the hard comparable gate uses complete independent
  scoring against the same-protocol public reference. Generic probes that
  failed the 3pt admission rule or required benchmark-label semantics were not
  promoted.

  LongMemEval is paused, not versioned internal evidence. A 2026-07-31 audit
  found two gold-label side channels: the historical rules-only path consumed
  answer annotations, while the later label-free path embedded raw
  `answer_*` session IDs into indexed and reader-visible content. The former
  0.720/0.888 and later 0.762/0.924 artifacts are retained only as contaminated
  provenance and must not be quoted as GoodMemory results. ImplicitMemBench's
  explicit
  retry-merged artifact reaches 0.6923666667 with zero failures, but does not
  replace a monolithic fresh Full-300 run. HaluMem, MemGym, and MINTEval remain
  release evidence rather than public benchmark claims. External adapter PR
  #17 remains open pending maintainer review. The complete `v0.6.0`
  release-candidate verification passes: the exact intended tree has 3743
  passing tests, 2 environment-gated Postgres skips, and 0 failures across 436
  files; the separate Postgres-enabled coverage run has 3634 passing tests, 0
  failures, 90.74% overall coverage, and 94.40% storage coverage. Node
  20/22/24 packed-consumer smokes and desktop/mobile browser flows pass. The
  219-file tarball excludes `src/` and unpacks to 3,868,829 bytes (3.689603
  MiB). The published GitHub asset is `goodmemory-0.6.0.tgz` with SHA-256
  `4b9c3d4b2aa7300943dfc334860bdc58bc88dcb0adc2f88137f1cd548bfe1cdf`;
  npm reports an unpacked size of 3,867,885 bytes.

## Public Boundary Notes

- root `goodmemory` no longer re-exports internal evolution contracts.
- automatic adapter/event `user_correction` path is proposal-first.
- automatic adapter/event `user_correction` path is proposal-first and records selective evidence plus proposal/promotion receipts instead of writing an intermediate active feedback memory; public `feedback()` remains the explicit durable procedural feedback entrypoint.
- Provider-backed retrieval is explicit; rules-only remains the default accepted mode, and provider failures surface as `provider_error`.
- Dashboard, cloud sync, and team workspace remain a Phase 48 no-go decision.
- There are no current `v0.7.2` benchmark claims. The prior `v0.6.0` LoCoMo,
  BEAM, and MemoryAgentBench results retain their strict, protocol, license,
  and event-ordering disclosures as versioned historical evidence alongside
  ImplicitMemBench. LongMemEval is a paused boundary pending a clean
  opaque-session-id rerun. The runtime capability descriptor and both
  README current-claim tables are empty. The strict gate enforces declaration status,
  package-version equality, evidence assertions, README row provenance, and
  disclosure fragments.
- ImplicitMemBench Full-300 rerun evidence guard note: `eval:phase-61-full300` rejects ambiguous source/output/run/budget selectors before launching live shards. The 2026-07-06 full-root run `run-phase61-full300-rerun-20260706-codex-current` completed 300 cases with zero failures and measured same-model diagnostic GoodMemory 0.7081666667 versus baseline 0.41. That number remains diagnostic; the later gpt-5.4 stored-answer rescore is versioned historical evidence, not a current-production score.
- ImplicitMemBench postchanges rerun note: `run-phase61-full300-rerun-20260706-postchanges-current` completed the same `/tmp/ImplicitMemBench` full-root 300-case run after recent local changes, but had 2 GoodMemory distilled execution failures (`text_answer_generation timed out after 180000ms`) and therefore should not replace the 0-failure canonical internal rerun above. Its best same-model diagnostic GoodMemory score was 209.05/300 = 0.6968333333, raw was 175.05/300 = 0.5835, distilled blocking was 153/200 = 0.765, and baseline was 131/300 = 0.4366666667. Treat this as drift evidence, not a public-claim artifact.
- ImplicitMemBench latest rerun note: `run-phase61-full300-rerun-20260706-latest-current` completed the same `/tmp/ImplicitMemBench` full-root 300-case run after the current benchmark-hardening work. It measured best same-model diagnostic GoodMemory score 211.06/300 = 0.7035333333, raw 179.06/300 = 0.5968666667, distilled blocking 155/200 = 0.775, and baseline 130/300 = 0.4333333333. It improved over the failed postchanges rerun but still had 1 GoodMemory distilled execution failure, so it does not replace the 0-failure `codex-current` source-answer run or the stored-answer gpt-5.4 comparability artifact.
- ImplicitMemBench after-hardening rerun note: `run-phase61-full300-rerun-20260706-after-hardening-current` completed the same `/tmp/ImplicitMemBench` full-root 300-case run while the stored-answer rescore runner was being hardened. It had `executionFailures: 0`, but measured a lower best same-model diagnostic GoodMemory score of 206.85/300 = 0.6895, raw 174.85/300 = 0.5828333333, distilled blocking 151/200 = 0.755, and baseline 130/300 = 0.4333333333. This is the freshest drift check and is cleanly completed, but it is lower than the canonical 0-failure `codex-current` source score by 5.60 passed-equivalent points and does not replace the stored-answer gpt-5.4 comparability artifact.
- ImplicitMemBench stored-answer rescore readiness note: `audit:phase-61-implicitmembench-rescore-readiness` verifies the canonical 0-failure Full-300 reports are ready for no-answer-rerun judge replacement. The same-model artifact `implicitmembench-rescore-readiness-20260706-current/rescore-readiness.json` finds `storedAnswersReady: true` but `readyForIndependentJudgeRescore: false`; the cross-version artifact `implicitmembench-rescore-readiness-gpt54-probe-current/rescore-readiness.json` finds `readyForIndependentJudgeRescore: true` with answer `gpt-5.5`, judge `gpt-5.4`, baseline 300/300 rows, GoodMemory composite 300/300 rows, 35 deterministic `structured_first_action` rows, and 265 judge-required rows (`text_behavior_judge` 165 + `priming_pair_judge` 100).
- ImplicitMemBench stored-answer independent-rescore runner note: `rescore:phase-61-implicitmembench` now consumes the canonical Phase 61 overall report, loads its baseline and GoodMemory source reports, preserves stored answers, carries deterministic `structured_first_action` rows forward unchanged, and rejudges only the stored `text_behavior_judge` plus `priming_pair_judge` rows needed for the baseline and `goodmemory-distilled-feedback+controlled-priming` composite. The command rejects same-model answer/judge configuration before reading source reports, rejects partial or mismatched source scopes before any judge call, writes `run-identity.json` with source report SHA-256 fingerprints before judge calls, resumes completed judge-required rows from `progress.jsonl` only when the run identity still matches, and writes `baseline-report.json`, `goodmemory-report.json`, `overall-summary.json`, and `rescore-summary.json` under the requested run directory with `sourceAnswersUnchanged: true`. The completed `implicitmembench-independent-rescore-gpt54-current` run produced 530 judge-required row decisions (265 baseline + 265 GoodMemory composite), 0 execution failures, GoodMemory 207.35/300 = 0.6911666667, blocking 153/200 = 0.765, priming 54.35/100 = 0.5435, and baseline 120/300 = 0.4. This clears the prior same-model blocker under the public claim gate, with required same-family disclosure.

## Active Research Slice

- **LongMemEval correction (2026-07-31):** every older LongMemEval number
  below is retained only to explain prior decisions. It is not valid benchmark
  evidence after discovery that rules-only ingestion used answer annotations
  and label-free ingestion exposed raw `answer_*` session IDs. A first paired
  development slice reported 13/16 versus 14/16, but is now superseded because
  its memory-builder boundary still received gold-bearing IDs and turn markers.
  Gold-blind protocol v2 removes answer/type/answer-marker fields and replaces
  every source identity with ordinal `session-N` before memory construction.
  Its clean development replay tied at 12/16, so compact assembly was rejected.
  The nominal 32-question candidate holdout was never opened by its runner, but
  a repository-wide audit found 13 IDs overlapping historical targeted profiles
  built from retrieval or answer outcomes; the runner now rejects opening it
  and it is not confirmatory evidence. Subsequent retrieval-only work also
  failed promotion: the temporal-operand protection replay exceeded its noise
  and context ceilings, and the fixed-budget pass-head replay kept gold
  coverage at 28/29 with zero gains or losses on a 16-case development cohort.
  All 28 query-derived operand endpoints were already covered; the one remaining
  official gold endpoint was a third annotated session outside that mechanism's
  one-head-per-pass target. No answer/judge/holdout call was made for the latter,
  production defaults remain unchanged, and no LongMemEval claim is restored.

- Phase 69 is complete. Its LoCoMo provider-free result remains accepted; its
  LongMemEval rows are withdrawn after the 2026-07-31 source-input audit. The
  artifact is
  `reports/quality-gates/phase-69/run-20260711-generalized-retrieval/phase-69-quality-gate.json`.
  It compared frozen baseline/candidate configurations on pinned full roots.
  LoCoMo evidence recall moved
  0.0229806935 -> 0.1334856928 on multi_hop and 0.0943627451 ->
  0.2720588235 on open_domain. The artifact also recorded LongMemEval
  evidence-session recall moving
  0.6794871795 -> 0.9102564103 on knowledge-update and 0.4250626566 ->
  0.7667919799 on temporal-reasoning, but that path exposed gold-bearing raw
  session IDs and is contaminated provenance, not retrieval evidence.
- Phase 70 is complete. Its baseline-only LoCoMo selector froze a 24-question
  target cohort across 8 conversations plus a 12-question protection cohort
  across 4 conversations; target evidence was present in Phase 69 membership
  but absent from the real MemoryPacket top-6. The pinned `gpt-5.6-terra` Gurki
  run completed 36/36 applied reranks with `executionFailures: 0`, no fallback,
  and unchanged membership. Target top-6 evidence recall moved 0.1041666667 ->
  0.7708333333; protection moved 0.4166666667 -> 0.6666666667. See
  `reports/eval/research/phase-70/locomo/run-phase70-reranker-focused-gpt56-terra-current/reranker-eval.json`
  and `reports/quality-gates/phase-70/run-20260711-reranker-and-evidence/phase-70-quality-gate.json`.
  This is a targeted retrieval-order diagnostic, not a full LoCoMo answer score
  or public benchmark claim.
- Phase 71 is complete. Its real-browser evidence covers users/scopes,
  categorized memory and supersession, candidate approve/reject/release,
  revision and destructive confirmations, recall trace, audit, read-only mode,
  token non-leakage, ETag conflict handling, idempotent retry, and desktop/mobile
  layouts with clean normal-flow consoles. The accepted quality gate records
  the full repository suite with 0 failures, 0 LLM calls, and a package below 4 MiB at
  `reports/quality-gates/phase-71/run-20260711-admin-inspector/phase-71-quality-gate.json`.
  Phase 72 is complete; its accepted benchmark and versioned release gate is
  tracked under `reports/quality-gates/phase-72/run-20260716-final/`.
- Phase 62 established the first Sequential Benchmark Hardening machinery, but
  its LongMemEval numeric evidence is withdrawn.
- Shared strict CLI scalar guard note: migrated Sequential benchmark evidence entrypoints that use the shared strict scalar helper reject missing values, flag-as-value mistakes, duplicate scalar flags, empty values, and whitespace-padded values before downstream parsing. This is evidence-input canonicalization only; it does not change benchmark scores or public-claim boundaries.
- Historical Phase 63 / P67 BEAM evidence includes an official-protocol 0.802 score, but it is no longer a current public claim because the recall profile is repo-eval-only; the answer-rule lane is paused. The earlier accepted rules-only measured checkpoint remains the internal binary-track baseline: answer-pack hardening (`--evidence-pack`, `src/eval/protocol-reader/evidencePack.ts`) raised answer accuracy from the no-pack 0.56 baseline (224/400) and the prior evidence-pack 0.6525 checkpoint (261/400) to 0.695 (278/400) at identical recall (0.9621), `executionFailures: 0`, gate accepted. The historical P67 declaration reported official-protocol 0.802 versus the 0.49 public reference; its 122/400 binary-track wrong answers and category weak spots remain archived gap evidence.
- Contaminated historical LongMemEval checkpoint: `run-phase62-longmemeval-full500-current-after-remaining-personal-hybrid-retry-r1-merged-20260517T161058Z` recorded 454/500 answer accuracy and 0.9590 evidence-session recall, but its answer-aware input path means it is provenance only, not accepted evidence.
- **WITHDRAWN 2026-07-31:** the historical LongMemEval P67-B declaration
  recorded 0.720 (360/500) with `goodmemory-rules-only`, but that ingest mode
  used benchmark answer annotations. The artifact remains for provenance only;
  it is no longer versioned evidence or a lower-bound claim.
- Phase 62 CLI evidence guard note: LongMemEval eval/full500/summary/retry entrypoints reject duplicate mode/source/output/run/budget selectors, and output run ids must be single path segments. This protects tooling inputs and directories only; it does not rehabilitate withdrawn scores.
- Phase 62 LongMemEval source-root env guard note: base eval/readiness resolution rejects empty or whitespace-padded `GOODMEMORY_LONGMEMEVAL_ROOT` fallback values before benchmark-root resolution. This is source-root integrity hardening only.
- Phase 62 gate CLI guard note: `gate:phase-62` rejects duplicate gate-output selectors and requires a single-segment run id. This is gate-input hardening only and does not rehabilitate withdrawn scores.
- P67-B deterministic-subset helper guard note: `eval:phase-62-deterministic-subset` rejects duplicate scalar report/output/profile selectors before resolving the source report: `--report-path`, `--run-id`, `--output-dir`, `--claim-profile`, and `--baseline-profile`; `--run-id` must also be a single path segment. This hardens tooling only and does not rehabilitate the withdrawn 0.720 artifact.
- Phase 65 union-live measurement run-directory guard note: legacy `measure-locomo-union-live.ts` now requires output `--run-id` values to be a single path segment before writing progress checkpoints, extraction caches, or `union-live-report.json` under `--output-dir`. This is older union-candidate live-evidence hardening only; it does not change LoCoMo retrieval scores, answer scores, default status, or public-claim boundaries.
- Phase 65 embedding-free comparison source/output guard note: `run-phase-65-locomo-embedding-free-comparison.ts` now rejects output directories that resolve to the benchmark root before parsing can hand off to the arm runner, and the runner repeats the same check before any arm can read the benchmark root. This is gateway-free comparison evidence integrity hardening only; it does not change LoCoMo retrieval scores, answer scores, default status, or public-claim boundaries.
- Phase 65 measurement source-root guard note: `measure-locomo-levers.ts`, `measure-locomo-neural.ts`, `measure-locomo-union-live.ts`, and `run-phase-65-locomo-embedding-free-comparison.ts` now reject empty or whitespace-padded `GOODMEMORY_LOCOMO_ROOT` fallback values before benchmark-root resolution. This is source-root integrity hardening for LoCoMo lever, neural, union-live, and gateway-free comparison evidence only; it does not change LoCoMo retrieval scores, answer scores, default status, or public-claim boundaries.
- Phase 66 release-readiness CLI guard note: `gate:v0-3-release-readiness` rejects duplicate `--skip-build`, `--skip-tests`, `--strict`, and `--output-dir` flags before running package/release checks. This is release-gate input hardening only; it does not change benchmark scores or public claims.
- Public-claim gate note: `gate:public-benchmark-claim` validates declaration shape, metric direction and baseline improvement, derived answer/judge separation, full commit identity, tracked historical-projection assertions, and README row provenance/disclosures. It checks internal declaration consistency; it does not independently prove upstream licenses or reconstruct ignored raw reports. Historical source fingerprints can be checked locally with `bun run scripts/project-historical-evidence.ts`. A current claim must have `candidate_public_claim` status and a `run.packageVersion` equal to the current package version. Historical rows live under separate markers and remain consistency-checked without becoming current claims. For `v0.7.2`, strict mode should find zero current claims, four versioned historical rows, and LongMemEval as one paused declaration.
- Phase 67 benchmark-prompt rescore evidence note: `eval:official-rescore` rejects ambiguous selectors, source/output overlap, malformed identities and progress rows, source fingerprint drift, judge-model drift, and incomplete judging. Its `rescore-summary.json` records source fingerprints, judge identity, selected/source scope, and a benchmark-and-model-aware claim boundary. LongMemEval runs with gpt-5.4 or gpt-5.5 are explicitly official-prompt-compatible but not directly comparable to published official scores because those models are outside the pinned evaluator model zoo. Stored answers remain separate from derived artifacts, and no rescore becomes a public claim without the claim gate.
- Phase 67 official-rescore cache writer / summary validation note: `eval:official-rescore` serializes progress through the same strict shapes accepted by resume parsing and validates final summaries, scope counts, fingerprints, category aggregates, and stored-answer boundaries before write. Existing LoCoMo and BEAM scores remain versioned historical evidence; refreshed LongMemEval artifacts preserve contaminated provenance only.
- **WITHDRAWN 2026-07-31:** the Phase 72 LongMemEval verifier/rescore chain
  recorded 0.720 and 0.924, but its source answers came from contaminated
  LongMemEval inputs (answer-aware historical ingestion or raw `answer_*`
  session IDs). Rescore integrity cannot repair source-input leakage. The
  tooling remains, but none of these numbers is evidence.
- Accepted BEAM smoke: `run-phase63-beam-smoke-current` and gate `run-20260518003000`.
- Latest accepted BEAM retained diagnostic: `run-phase63-beam-100k-recall-diagnostic-rules-project-card-total-count-current-20260615T200000Z`, evidence-chat recall 0.9620612564274538, missed 20/355, wrong-recall/noise 167/400, zero-recall 0, and hit/missing/noise ids 1022/72/810 -> 1023/71/807 (3:multi_session_reasoning:1 recovered from recall 0.5 to 1 — fourth multi_session_reasoning recovery via the multi-facet contradiction route, exhausting the confirmed-reachable msr cases; a ground-truth-misaligned [16,116] pair where the narrowed gate avoids the sibling knowledge_update 3:ku:2; returns exactly [16,116], recovering the contact-form turn 16 and shedding noise 60/88/36; cleanest single delta, a recall gain plus a noise reduction, zero ripples). The multi-facet contradiction route now serves contradiction, knowledge_update, and multi_session_reasoning (both "how much" comparisons and "how many" aggregates). Remaining partial-recall families: instruction_following (6 — via the instructionRules companionPattern recipe, NOT multiFacetGroups), multi_session_reasoning (the remaining cases have a genuine upstream candidate-pool gap, needing candidate-generation work).
- Phase 63 general-lever recall remeasure note: `eval:phase-63-general-levers` keeps non-provider `floor` / `bm25` arms embedding-free even when provider embedding env is present, preserves provider semantic-union behavior for union arms, includes non-default `--semantic-topk` values in default union run ids, and requires output `--run-id` values to be a single path segment before invoking the recall diagnostic. This is BEAM recall/routing evidence-input and output-directory hardening only; it does not change answer score, closure, or public-claim boundaries.
- Phase 63 external-root prep CLI guard note: `prepare:phase-63-beam` rejects duplicate scalar source/output/fetch selectors before fetching Hugging Face or GitHub raw rows and before writing the refreshed BEAM root: `--dataset`, `--github-api-root`, `--github-concurrency`, `--github-raw-root`, `--length`, `--offset`, `--output-root`, `--source`, and `--split`. This is BEAM root-prep evidence-input hardening only; it does not change answer score, recall, closure, or public-claim boundaries.
- Phase 63 gate CLI guard note: `gate:phase-63` rejects duplicate scalar gate output selectors (`--output-dir`, `--run-id`), and `gate:phase-63-beam-closure` rejects duplicate scalar closure-gate source/output selectors (`--closure-report`, `--output-dir`, `--run-id`) before reading or writing gate artifacts; both gate commands require `--run-id` to be a single path segment. This is BEAM gate evidence-input and gate-directory hardening only; it does not change answer score, recall, closure, or public-claim boundaries.
- Accepted BEAM measured full-run checkpoint (rules-only, evidence pack): `run-phase63-beam-100k-live-closure-gpt55-evidence-pack-answer-hardening-current` — 278/400 answer accuracy (0.695), evidence-chat recall 0.9620612564274538, missed-recall 20/355, wrong-answer 122/400, `executionFailures: 0`; prerequisite zero-failure diagnostic `run-phase63-beam-100k-recall-diagnostic-rules-postmerge-current`, gate `run-phase63-beam-closure-gate-gpt55-evidence-pack-answer-hardening-current` accepted. Models: `gpt-5.5` answer + `gpt-5.5` judge (`ai.gurkiai.com`). The answer context is built by the eval protocol reader `src/eval/protocol-reader/evidencePack.ts` (operation inferred from the question, source-ordered + timestamped, current-value/timeline/count/instruction/synthesis framing): +54 cases over the prior no-pack baseline (`run-phase63-beam-100k-live-closure-gpt55-current`, 224/400 = 0.56, same recall) and +17 cases over the prior evidence-pack checkpoint (`run-phase63-beam-100k-live-closure-gpt55-evidence-pack-current`, 261/400 = 0.6525). This is pipeline/gate evidence only: fitted recall 0.9621 vs generalization floor 0.6822, same-model judge bias, no numeric accuracy pass threshold, and still below the 0.70+ next improvement target. The measured full-run path supports `goodmemory-rules-only` and `goodmemory-hybrid`.
- BEAM answer-gap tooling is already present: `scripts/analyze-phase-63-live-answer-gap.ts`, `scripts/run-phase-63-beam-live-ablation.ts`, and the internal `src/eval/protocol-reader/evidencePack.ts`. Baseline no-pack analysis (`run-phase63-beam-live-answer-gap-baseline-current`) had 176 wrong: 103 full-recall-clean, 41 full-recall-noisy, 18 missing-evidence. The prior evidence-pack analysis (`run-phase63-beam-live-answer-gap-evidence-pack-current`) had 139 wrong: 76 full-recall-clean, 34 full-recall-noisy, 16 missing-evidence, 8 abstention, 5 unknown. The latest answer-hardening analysis (`run-phase63-beam-live-answer-gap-answer-hardening-current`) has 122 wrong: 58 full-recall-clean, 37 full-recall-noisy, 15 missing-evidence, 7 abstention, 5 unknown. The top repair families after the preference bucket split are conflict_update 29 (dominant full-recall-clean), instruction_following 27 (dominant full-recall-noisy), temporal_order 23 (dominant full-recall-clean), aggregate_count 15, summarization 9, preference_following 8, abstention 7, and the remaining judge_or_expected_answer 3. Answer-pack hardening now has live proof, not only unit proof; local pre-live hardening has also added latest-candidate target date/time/quantity cues, current-value filtering that keeps later sibling-entity metrics out of the ledger, conservative current-value stale-answer rewrite from updated/superseded target cues, contradiction minimal-pair extraction that leads with affirmative evidence, preserves weak affirmative wording such as registered/recommended/planned/invited without upgrading it to completion, suppresses adjacent implementation noise, recognizes same-turn strong `did not` / `didn't` denial clauses, and rewrites one-sided contradiction answers from the evidence guide into both-sides-plus-clarification answers, aggregate/count ledgers that preserve hyphenated and spaced compound word-number quantities and compute source-backed calendar interval candidates, conservative single-candidate calendar-interval answer rewrite, instruction answer-content cues that filter companion openers out of named tools/examples and surface concrete date, amount, percentage, date/format requirements, explicit response-content requirements, and comma-preserved numeric values, conservative instruction no-answer repair from explicit response-requirement cues, conservative generic instruction response-content repair from guide cues, temporal question-target timeline anchors that keep source order while filtering generic order/action words and reducing adjacent project noise, conservative unordered temporal-answer rewrite from source-ordered target anchors, value-bearing summary anchors, conservative summary no-answer repair from source-backed checklist cues, preference response-requirement cues that make lightweight/minimal-dependency, automation, step-by-step, direct-link, morning, and practical/logical constraints visible before answer support, conservative preference no-answer repair from those explicit response requirements, information-extraction coverage cues that preserve source-backed fields, deadlines, preparation steps, and required sub-items without adding unrequested identifiers, conservative extraction no-answer repair from source-backed detail cues, required summary source-coverage audits for late topic shifts, analyzer-level source-coverage warnings for expected cues found outside declared source chats, adjacent-only abstention rewrites for module-detail and atmosphere questions, and topic-specific missing-context abstention wording in focused live prompts. The focused summarization value-anchor live slice `run-phase63-beam-live-slice-summary-value-anchors-prelive-current` stayed at 1/9 correct with `executionFailures: 0`; its analyzer rerun `run-phase63-beam-live-answer-gap-summary-value-anchors-current` found 5/8 wrong summarization cases with source-coverage warnings (21 cues), so the next summarization repair is source-coverage / expected-answer compatibility rather than answer-pack-only prompt work. The full source-coverage audit `run-phase63-beam-live-answer-gap-answer-hardening-source-coverage-current` preserves the 122-wrong shape and adds status counts of 95 covered-or-no-warning, 15 expected-cues-outside-source, and 12 no-declared-source-ids; warning buckets are temporal_order 9/16, summarization 5/21, aggregate_count 2/4, conflict_update 1/2. Manual summarization audit classifies `9:summarization:1`, `14:summarization:1`, and `19:summarization:1` as declared-source mismatches, while `20:summarization:1` and `20:summarization:2` have no declared source ids. The corrected source-covered summarization slice `run-phase63-beam-live-slice-summary-source-covered-v2-prelive-current` filtered to `12:summarization:1` and `14:summarization:2`, measured 1/2 with `executionFailures: 0` and evidence recall 1.0, and leaves `14:summarization:2` as a source-covered expected-answer/source-content mismatch rather than a proven generic answer-pack repair. The broader source-covered preference+summarization slice `run-phase63-beam-live-slice-pref-summary-source-covered-20260706-current` measured 7/9 with `executionFailures: 0` and evidence recall 1.0; its analyzer `run-phase63-beam-live-answer-gap-pref-summary-source-covered-20260706-current` leaves two full-recall-clean residuals: `18:preference_following:2` for preference constraint framing and `14:summarization:2` for structured summary / expected-answer compatibility. Preference guardrails now cover generic morning-routine ways answers and noisy practical/logical decision-preference answers. The full 9-row rerun `run-phase63-beam-live-slice-pref-summary-source-covered-preference-ways-current` stayed 7/9 because live variance introduced a new `12:preference_following:1` regression while `18:preference_following:2` passed; targeted validation `run-phase63-beam-live-slice-preference-two-row-guardrails-current` scored 2/2 with `executionFailures: 0`, evidence recall 1.0, and analyzer `run-phase63-beam-live-answer-gap-preference-two-row-guardrails-current` had zero wrong rows. The live-slice runner can filter `--answer-gap-source-coverage-status covered-or-no-warning`; use that filter for answer-pack-only slice validation so source metadata mismatches do not dilute the measurement. The next repair should target conflict/update resolution, instruction noise budgeting, temporal timeline granularity, count aggregation, summary/source coverage, preference constraints, information extraction coverage, abstention calibration, and judge/expected-answer compatibility without BEAM expected-answer-specific rules.
- Phase 63 BEAM source-audit update: analyzer `run-phase63-beam-live-answer-gap-pref-summary-source-covered-source-audit-current` preserves the focused 9-row rerun shape (7/9 correct in `run-phase63-beam-live-slice-pref-summary-source-covered-preference-ways-current`) but reroutes the remaining `14:summarization:2` wrong row to evidence-source selection: `dominantSourceCoverageStatus=expected-cues-outside-source`, one source-coverage warning, and expected cue `planning resource` found at chat 143 outside the declared evidence ids [4, 9, 13]. This keeps `12:preference_following:1` as an answer-time preference issue while preventing `14:summarization:2` from being treated as answer-pack-only summarization work.
- Phase 63 answer-gap / ablation CLI guard note: `scripts/analyze-phase-63-live-answer-gap.ts` and `scripts/run-phase-63-beam-live-ablation.ts` reject duplicate scalar source/output/mode selectors before reading live reports or writing derived evidence, including `--benchmark-root`, `--live-report`, `--output-dir`, `--output-path` where supported, `--mode`, `--profile`, `--limit`, `--run-id`, and `--scale`. They reject derived output report paths that resolve to the input `--live-report` before reading benchmark or live-report sources, and the answer-gap analyzer also rejects explicit `--output-path` values that resolve to any candidate BEAM source file under `--benchmark-root`; both tools require output `--run-id` values to be a single path segment before deriving default output paths. This is BEAM answer-gap/ablation evidence-input and output-directory hardening only; it does not change BEAM scores, recall, checkpoint status, or public-claim boundaries.
- Phase 63 base eval CLI guard note: `eval:phase-63` rejects duplicate scalar source/output/run selectors before smoke or full report generation: `--benchmark-root`, `--limit`, `--mode`, `--offset`, `--output-dir`, `--run-id`, and `--scale`; repeated multi-value selectors such as `--case-id`, `--profile`, and `--question-type` remain repeatable. It also requires output `--run-id` values to be a single path segment before deriving smoke/full report directories. This is BEAM smoke/full evidence-input and evidence-directory hardening only; it does not change BEAM scores, recall, checkpoint status, or public-claim boundaries.
- Phase 63 recall diagnostic / analyzer CLI guard note: `eval:phase-63-recall-diagnostic` and `analyze:phase-63-recall-diagnostic` reject duplicate scalar source/report/output/run selectors before running recall diagnostics or comparing reports. The recall runner keeps repeated `--profile` support but makes `--benchmark-root`, `--limit`, `--output-dir`, `--run-id`, and `--scale` single-valued, and requires output `--run-id` values to be a single path segment before deriving the report directory; the analyzer makes `--baseline-report-path`, `--baseline-run-id`, `--benchmark-root`, `--output-dir`, `--output-path`, `--profile`, `--report-path`, `--run-id`, and `--source-turn-limit` single-valued, and requires `--run-id` / `--baseline-run-id` values to be single path segments before resolving default report paths. The analyzer also rejects output paths that resolve to either the analyzed report or the baseline report before reading inputs, and rejects output paths that resolve to any candidate BEAM source file under `--benchmark-root` before reading benchmark source rows. This is BEAM recall/noise evidence-input and report-directory hardening only; it does not change BEAM scores, recall, checkpoint status, or public-claim boundaries.
- Phase 63 BEAM source-root env guard note: `prepare:phase-63-beam`, `eval:phase-63`, `eval:phase-63-recall-diagnostic`, `eval:phase-63-live-slice`, `eval:phase-63-live-closure`, `scripts/analyze-phase-63-live-answer-gap.ts`, and `scripts/run-phase-63-beam-live-ablation.ts` reject empty or whitespace-padded `GOODMEMORY_BEAM_ROOT` fallback values before source-root or output-root resolution. This is BEAM root-prep, smoke/full, recall, live, answer-gap, and ablation source-root integrity hardening only; it does not change BEAM scores, recall, checkpoint status, or public-claim boundaries.
- Phase 63 initial report analyzer guard note: `analyze:phase-63-beam` rejects duplicate scalar source/output/run selectors (`--report-path`, `--output-path`, `--run-id`) before reading the source report or writing miss-case analysis, requires `--run-id` to be a single path segment before resolving the default source report path, and rejects output paths that resolve to the input `--report-path` before reading the source report. This protects the early BEAM miss-case workbench evidence from repeated-selector ambiguity, source-report path traversal, or source-report overwrites without changing BEAM scores, recall, checkpoint status, or public-claim boundaries.
- Phase 63 live-slice / live-closure CLI guard note: `eval:phase-63-live-slice` now rejects malformed repeated selector flags before reading answer-gap or benchmark files. `--answer-gap-bucket`, `--answer-gap-source-coverage-status`, and `--case-id` values must be present, non-empty, unpadded, and unique, and answer-gap buckets/source-coverage statuses are allow-listed. The live-slice and live-closure parsers also reject duplicate boolean mode switches (`--evidence-pack`, `--resume`) and scalar source/output selectors where supported, including `--answer-gap-report`, `--benchmark-root`, `--case-selection`, `--limit`, `--output-dir`, `--profile`, `--recall-report`, `--run-id`, and `--scale`, before report generation; `--run-id` must be a single path segment. This is focused-slice, closure, and live-evidence-directory integrity hardening only; it does not change BEAM scores, recall, checkpoint status, or public-claim boundaries.
- Phase 63 live-slice selection-lineage note: new `eval:phase-63-live-slice` reports persist optional `selection` metadata for explicit case ids, case-selection mode, recall report path, answer-gap report path, answer-gap buckets, source-coverage filters, and limit. This makes focused answer-gap slice evidence auditable without relying on run-id naming conventions; it is metadata hardening only and does not change BEAM scores, recall, closure status, or public-claim boundaries.
- Phase 63 live-closure coverage guard note: `eval:phase-63-live-closure` now rejects live reports whose `cases.length` does not cover the expected full BEAM case count, and rejects present `selection` metadata unless it proves the report came from `caseSelection="all-cases"` with no answer-gap filters, explicit case ids, or limit. This prevents focused slices or summary-only artifacts from being wrapped as closure evidence; it does not change BEAM scores, recall, checkpoint status, or public-claim boundaries.
- Phase 63 closure-gate summary consistency note: `gate:phase-63-beam-closure` now rejects closure reports whose `profilesCompared` does not contain exactly the closure `profile`, whose `correctCases + wrongAnswerCases` does not equal `totalCases`, or whose `answerAccuracy` does not equal `correctCases / totalCases`. This keeps hand-edited or internally inconsistent closure artifacts from passing the gate without changing BEAM scores, recall, checkpoint status, or public-claim boundaries.
- Latest local BEAM pre-live infrastructure check: `/private/tmp/BEAM/100K.json` rebuilt from GitHub raw via `prepare:phase-63-beam` (20 rows), `eval:phase-63` and `gate:phase-63` passed with `executionFailures: 0`, and `run-phase63-beam-100k-recall-diagnostic-rules-prelive-current` compared with `run-phase63-beam-100k-recall-diagnostic-rules-postmerge-current` at `caseDeltaCount: 0` (evidence-chat recall 0.9620612564274538, missed 20/355, wrong-recall/noise 167/400, hit/missing/noise 1023/71/807). This is refreshed root/recall readiness, not answer-performance evidence.
- MemoryAgentBench (Phase 64) is closed as the agent-memory hardening slice. The reproducible external root (`prepare:phase-64-mab`) and deterministic upstream match-mode scorer are in place; the accepted zero-failure AR/CR live closure (`run-phase64-mab-ar-cr-live-closure-rerun-current`) measured CR 0.959 and AR 0.67, while TTL/LRU exposed answer-format boundaries. CR 0.959 reproduced the prior hand-made CR A/B on the reproducible root, so the shared `src/answer/currentValueResolution.ts` current-value resolution is not BEAM-only; the AR retrieval gap also drove the general zero-retrieval lexical fallback with `caseDeltaCount 0` on the 100K rules-only recall diagnostic. P67-C later recorded historical four-competency evidence (CR 0.959, TTL 0.767, AR 0.890, LRU 0.518; `executionFailures: 0` over 259 questions). The historical `v0.6.0` declaration retains judge-free CR 0.9589041096 and TTL 0.9333333333 versus no-memory 0.000; AR/LRU remain excluded because multiple-choice leakage makes them non-diagnostic.
- Phase 64 external-root prep CLI guard note: `prepare:phase-64-mab` rejects duplicate `--merge` and duplicate scalar source/output/budget selectors before fetching upstream rows or writing `cases.json`, including `--competency`, `--dataset`, `--offset`, `--max-questions`, `--max-chunks`, `--max-evidence-facts`, and `--output-root`. This is fixture-prep input hardening only; it does not change accepted MemoryAgentBench closure evidence or the scoped public claim.
- Phase 64 readiness analyzer guard note: `analyze:phase-64-readiness` rejects duplicate scalar source/output selectors (`--phase63-analysis-path`, `--output-dir`, `--output-path`, `--run-id`) before reading Phase 63 analysis or writing prep evidence, requires `--run-id` to be a single path segment before deriving the default output path, and rejects an output path that resolves to the input `--phase63-analysis-path` before reading the Phase 63 analysis file. This is prep-report input/source/output hardening only; it does not change accepted MemoryAgentBench closure evidence or the scoped public claim.
- Phase 64 smoke/live CLI guard note: `eval:phase-64-smoke` rejects duplicate `--evidence-pack`, `--live`, `--no-memory`, and `--resume` flags plus duplicate scalar source/output selectors (`--benchmark-root`, `--limit`, `--output-dir`, `--run-id`) before report generation, requires `--run-id` to be a single path segment, and requires `--limit` to be a canonical positive integer string rather than scientific or decimal notation. This is evidence-input, evidence-directory, and budget-selector hardening only; it does not change accepted MemoryAgentBench closure evidence or the scoped public claim.
- Phase 64 MemoryAgentBench source-root env guard note: `prepare:phase-64-mab` and `eval:phase-64-smoke` reject empty or whitespace-padded `GOODMEMORY_MAB_ROOT` fallback values before output-root or benchmark-root resolution. This is fixture-prep, retrieval, and live source-root integrity hardening only; it does not change accepted MemoryAgentBench closure evidence or the scoped public claim.
- LoCoMo's historical `v0.6.0` public-opt-in declaration covers all 1540 non-adversarial questions and reports strict token-F1 0.6298701299, independent official-protocol accuracy 0.8707792208, and open-domain 59/96 = 0.6145833333, with zero execution/judge failures and the CC BY-NC 4.0 non-commercial disclosure. Its older versioned declaration (strict 0.6117, judge-protocol 0.837) and Phase 65 P4 full-10 result (0.6198 versus no-memory 0.2276 over 1986 questions) remain historical evidence. Phase 65 case-level hardening is paused; Phase 69 owns generalized candidate admission and noise control. Earlier live answer generator + evidence-pack wiring (commit `3f9cf5e`, `--live --evidence-pack`, gpt-5.5, deterministic LoCoMo match-mode scoring, no judge) and reproducible non-vendored external-root prep (commit `ed08dd9`, `prepare:phase-65-locomo`) are on main. A representative single-conversation pressure run (`locomo-live-pack-full`, full conversation 1, 199 questions, `executionFailures: 0`) measured overall answer accuracy 0.020 (4/199), purely recall-bound. Follow-up eval-only retrieval research ruled out positional dialog windows, rules-light query expansion, and LLM turn-caption enrichment (commit `2b2ec71`), and P65-R003 later found a real neural endpoint ties BM25 exactly; the refined bottleneck is candidate-pool admission because additive semantic/BM25 scoring only re-ranks already-admitted lexical candidates.
  Source-execution guard note: `eval:phase-65-reanswer-report` rejects source reports with non-zero `executionFailures` before source answer-row completeness checks, so failed retrieval/live-source artifacts cannot be reused as gold-evidence-only or answer-policy replay inputs.
  Reanswer run-directory guard note: `eval:phase-65-reanswer-report` now requires output `--run-id` values to be a single path segment at CLI parse time and in the programmatic runner before source reports are read. This is reanswer evidence-directory hardening only; it does not change LoCoMo retrieval scores, answer scores, default status, or public-claim boundaries.
  Retrieval-probe CLI guard note: the eval-only dialog-window and rules-light query-expansion probes reject duplicate scalar source/run/window selectors (`--benchmark-root`, `--run-id`, `--window-radius`) before writing comparison reports, require `--run-id` to be a single path segment, require `--window-radius` to be a positive integer, and reject empty or whitespace-padded `GOODMEMORY_LOCOMO_ROOT` fallback values before benchmark-root resolution. This is evidence-input, source-root, and report-directory integrity hardening only; it does not change LoCoMo retrieval scores, answer scores, default status, or public-claim boundaries.
  Smoke/live source-root and run-directory guard note: `eval:phase-65-smoke` now requires `--run-id` to be a single path segment before writing smoke reports, live progress checkpoints, or extraction caches under `--output-dir`, and rejects empty or whitespace-padded `GOODMEMORY_LOCOMO_ROOT` fallback values before benchmark-root resolution. This is source-root and evidence-directory hardening only; it does not change LoCoMo retrieval scores, answer scores, default status, or public-claim boundaries.
  Provider-run timeout/resume guard note: `eval:phase-65-smoke` now supports `--provider-embedding-timeout-ms` and `--provider-embedding-run-timeout-ms` for provider-backed LoCoMo probes, and provider-backed retrieval-only runs now checkpoint completed question rows through `live-progress.jsonl` for `--resume`. The 7-question near-miss rel0.8 retry with 5s embedding requests and a 60s run watchdog now exits with `LocomoProviderEmbeddingRunTimeoutError` while starting `locomo-conv-42`; it wrote only the progress config header before timing out. Resume also rejects duplicate checkpoint rows, checkpoint rows outside the selected question scope, malformed non-tail checkpoint JSON, and non-header JSON objects that do not match the full progress-row shape before replaying cached results; only the final torn JSON line from a killed run is tolerated, and legacy checkpoints may still omit `answerTokenF1`. The explicit 1ms watchdog proof `locomo-multihop-near-miss-label-rel08-retrieval-timeout-partial-current` produced a partial report with 7 selected rows, 7 `executionFailures`, and zero retrieved turns. This is timeout and checkpoint-accounting evidence only, not retrieval recovery.
  Failure-row retention note: `eval:phase-65-smoke` now keeps failed selected rows in nonzero-failure reports for seed, recall, provider-run-timeout, and answer-generation errors, but does not checkpoint those failed rows. New failed rows carry optional `executionFailureStage` and `executionFailureMessage` metadata, and shared report validation rejects malformed stage/message pairs or zero-failure rows that still carry failure metadata. Failed rows remain retryable under `--resume` and still cannot be used as clean source evidence while `executionFailures` is nonzero. Shared smoke-report validation also rejects live-answer reports whose `executionFailures` count does not equal the number of failed rows with null `answerCorrect` and null `generatedAnswer`, keeping failure accounting auditable before downstream analyzers consume the report.
  Evidence-pack category-operation routing note: LoCoMo live/reanswer evidence-pack contexts now pass `multi_hop` into the shared `multi_session_reasoning` answer framing and `adversarial` into the shared `abstention` answer framing before live answer generation. This is deterministic answer-context hardening for multi-hop/no-answer repair only; it is not new live-score evidence, default promotion, or a public-claim change.
  Current local code has opt-in semantic candidate-generation union plumbing (`retrieval.semanticCandidates`, `--semantic-candidates`, runner flag `--provider-embedding`) with external-root provider evidence. The bounded-noise topK16/maxAdditions4 point lifted conv-1 live accuracy from 4/199 (0.020) to 97/199 (0.487), held-out conv-30 to 67/105 (0.638), held-out conv-41 to 95/193 (0.492), held-out conv-44 to 85/158 (0.538), and held-out conv-42 to 106/260 (0.408), all with `executionFailures: 0`. The adversarial abstention scorer repair is deterministic: `No information available` adversarial gold accepts explicit abstention aliases like `I do not know`, while still rejecting the tempting answer; `--resume` re-scores checkpointed live answers with the current scorer.
  Full-root category slices are now assembled by `summarize:phase-65-locomo-categories` into `locomo-category-matrix-top16-add4-live-pack-current/category-summary.json`: 1986 questions, 983/1986 live accuracy (0.4949647533), weighted evidence recall 0.5884050761, 1081/1986 fully retrieved, noise 15235, and `executionFailures: 0`. The category-gap diagnostic `locomo-category-gap-analysis-top16-add4-live-pack-current/category-gap-analysis.json` splits the 1003 wrong answers into 647 missing-evidence wrong rows and 356 full-recall-but-noisy wrong rows, with 0 clean full-recall wrong rows. Category summary and category-gap artifacts now include per-source `questionCount` lineage in `sourceReports`, so assembled/gap totals can be audited against their input shard sizes, and Phase 65 JSON post-processors/reanswer replay reject smoke reports whose top-level `questionCount` does not match `cases.length` before computing derived evidence. Follow-up retrieval-only budget probes showed decomposition/iteration is not the open_domain lever (recall 0.2763991013 -> 0.2822990939, noise 696 -> 858), while wider topK32/maxAdditions8 semantic admission improves missing-evidence categories at a noise cost: open_domain recall 0.3536560458 / 26/96 fully retrieved / noise 1050, multi_hop recall 0.3972616166 / 48/282 / noise 3237. The new relative-score floor (`minRelativeScore`) trims that wider-admission noise while preserving part of the gain: topK32/maxAdditions8/rel0.8 measured open_domain 0.3432393791 / 25/96 / noise 936 and multi_hop 0.3767491208 / 42/282 / noise 2939; the budget-delta analyzer shows open_domain has the better retrieval/noise tradeoff at +0.0278501157 recall per 100 added noise turns versus multi_hop +0.0068534205. The first wider-admission live validation, `locomo-open-domain-semantic-provider-top32-add8-rel08-live-pack-current`, did not convert that retrieval gain into answer gain: topK16/maxAdditions4 and topK32/maxAdditions8/rel0.8 both score 22/96 (0.2291666667) open_domain answer accuracy with `executionFailures: 0`, while the gap analysis moves wrong rows from 66 missing-evidence / 8 full-recall-noisy to 59 missing-evidence / 15 full-recall-noisy. The live-delta diagnostic `locomo-open-domain-top16-add4-vs-top32-add8-rel08-live-delta-current/live-delta.json` shows why this is not defaultable: 3 answers improved, 3 regressed, +6 fully retrieved, +240 noise turns, 9 unconverted retrieval gains, and 3 noisy full-recall regressions. The opt-in answer-policy probe `locomo-open-domain-rel08-commonsense-live-current` then held retrieval/noise fixed and enabled `--allow-commonsense-resolution`: open_domain improved to 27/96 (0.28125) with `executionFailures: 0`, and `locomo-open-domain-rel08-vs-commonsense-live-delta-current/live-delta.json` shows 7 improvements, 2 regressions, 20 same-correct, 67 same-wrong, 0 retrieval delta, and 1 noisy full-recall regression. The category-scoped strict guard validation `locomo-open-domain-rel08-commonsense-strict-live-current` keeps most of that open_domain gain while carrying `--strict-no-evidence-abstention`: 26/96 (0.2708333333), `executionFailures: 0`; strict-vs-nonstrict delta shows 1 improvement, 2 regressions, and -1 net, while strict-vs-non-commonsense rel0.8 still shows +4 net (6 improvements, 2 regressions). Its gap artifact has 57 missing-evidence wrong rows and 13 full-recall-noisy wrong rows. A targeted adversarial/no-answer replay over 15 baseline-correct rows (`locomo-adversarial-commonsense-safety-reanswer-current`) reused the original retrieved turn ids and scored 15/15 with `executionFailures: 0`; its delta versus no-commonsense replay shows 1 improvement, 0 regressions, and no retrieval/noise delta, which is narrow safety evidence. The broader 60-row adversarial/no-answer replay showed non-strict commonsense is not safe enough by itself: `locomo-adversarial-commonsense-safety-reanswer-broad60-current` tied no-commonsense at 46/60 (0.7666666667) and introduced a zero-recall abstention regression (`conv-26:q181` became `a plate`). The opt-in category-scoped strict abstention guard `--strict-no-evidence-abstention` plus commonsense (`locomo-adversarial-commonsense-strict-safety-reanswer-broad60-current`) scored 48/60 (0.8), `executionFailures: 0`, with 2 improvements, 0 regressions, 46 same-correct, 12 same-wrong versus both no-commonsense and non-strict commonsense deltas; it restored `conv-26:q181` to abstention and repaired `conv-43:q210`, lowering missing-evidence wrong rows from 13 to 11 while leaving 1 full-recall-noisy wrong row. The new answer-policy slice selector (`analyze:phase-65-locomo-answer-policy-slice`) wrote `locomo-cross-category-answer-policy-slice-current/answer-policy-slice.json`, a 45-row manifest across single_hop, multi_hop, and temporal, and now preserves source report provenance per selected question while splitting same-category `reanswerJobs` by source report. The first single_hop replay showed global commonsense is unsafe outside open_domain: baseline `locomo-single-hop-answer-policy-slice-baseline-current` scored 6/15, global commonsense+strict `locomo-single-hop-answer-policy-slice-commonsense-strict-current` scored 5/15, and delta `locomo-single-hop-answer-policy-slice-commonsense-strict-delta-current/live-delta.json` shows -1 net with 1 noisy full-recall regression. The current prompt scopes commonsense resolution to open_domain; completed open_domain-scoped manifest deltas show single_hop 0 net with 0 regressions, multi_hop -1 net with 1 improvement and 2 regressions, and temporal 0 net with 1 improvement and 1 regression. `eval:phase-65-reanswer-report` now retries transient answer-generation failures before counting execution failures, retains hard-failed selected rows with null answer fields, accepts `--question-id-file` for manifest-driven replay, and adds `--gold-evidence-only-context` for gold-label noise-isolation replay over retrieved gold evidence only; this recovered the temporal baseline rerun to 15/15 answered and `executionFailures: 0`, while making future answer-policy and noise-isolation replay queues reproducible without silently dropping failed rows. This is answer-policy hardening plus negative clearance evidence, not default-profile promotion: open_domain retains most but not all of the commonsense gain, multi_hop still regresses on the selected risk slice, and unresolved missing-evidence/noise failures remain. Category blockers remain: single_hop 457/841, open_domain 22/96 by the non-commonsense rel0.8 baseline (27/96 non-strict commonsense; 26/96 category-scoped strict commonsense), multi_hop 86/282, temporal 178/321, and adversarial 240/446. A conv-44 minSimilarity sweep did not find a defaultable noise fix, and BEAM rules-only safety run `run-phase63-beam-100k-recall-diagnostic-rules-semantic-union-safety-current` compared against the prelive baseline at `caseDeltaCount: 0`. These are historical Phase 65 diagnostics; Phase 69 owns generalized retrieval, while the current LoCoMo row is the strict/judge dual-track declaration. No upstream data is vendored (MemoryAgentBench MIT; LoCoMo CC BY-NC 4.0, non-commercial).

- Phase 65 answer-policy bucketed replay note: newly generated `analyze:phase-65-locomo-answer-policy-slice` manifests now split `reanswerJobs` by source report, QA category, and answer-policy risk bucket (`baselineCorrectHighNoise`, `wrongFullRecallNoisy`, `wrongMissingEvidence`). `eval:phase-65-reanswer-report --reanswer-job-bucket` accepts those buckets, so follow-up replay can isolate one answer-policy risk bucket and one category without manual question-id copying. Legacy bucketless answer-policy manifests remain category-filterable, and `analyze:phase-65-locomo-answer-policy-slice -- --existing-slice <path>` upgrades already-selected slices without re-reading legacy source reports that predate current answer-context lineage checks. The local `locomo-cross-category-answer-policy-slice-current/answer-policy-slice.json` artifact now has 9 bucketed jobs covering the same 45 selected rows. This is replay-routing/auditability hardening only; it does not change LoCoMo retrieval scores, answer scores, default status, or public-claim boundaries.
- Phase 65 reanswer readiness and replay note: `analyze:phase-65-locomo-reanswer-readiness` checks manifest `reanswerJobs` against their declared source reports before live replay, rejects non-LoCoMo manifests and malformed source provenance, and emits explicit-question-id `replayPlan.commands` only for jobs whose source report is readiness-proven. The legacy audit `locomo-cross-category-answer-policy-reanswer-readiness-current/reanswer-readiness.json` over `locomo-cross-category-answer-policy-slice-current/answer-policy-slice.json` correctly found 9/9 jobs blocked because the old single_hop, multi_hop, and temporal sources lacked `answerContextMode` lineage. That source-readiness blocker is now cleared: the three current-lineage source refreshes completed with 45/45 answered, 19/45 correct, and `executionFailures: 0`; the rebuilt slice `locomo-cross-category-answer-policy-reanswer-readiness-current-slice-refresh-current/answer-policy-slice.json` selected 40 rows across 9 bucket/category jobs; and `locomo-cross-category-answer-policy-reanswer-readiness-after-source-refresh-current/reanswer-readiness.json` reports 9/9 ready, 0 blocked, with live-answer and provider-embedding env preflight ready. The regenerated replay reports cover 40/40 rows, score 15/40 with `executionFailures: 0`, and no longer inherit source `questionSelection`. The subset-aware aggregate artifact `locomo-cross-category-answer-policy-reanswer-delta-aggregate-current/reanswer-delta-aggregate.json` summarizes the nine replay deltas against their refreshed source subsets: baseline 15 correct vs replay 15 correct, net 0, with 2 improvements, 2 regressions, 13 same-correct rows, 23 same-wrong rows, 7 token-F1 near misses, and no retrieval/noise delta. Bucket totals isolate the only positive lift to `wrongFullRecallNoisy` (+2 over 10 rows) while `baselineCorrectHighNoise` regresses -2 over 15 rows and `wrongMissingEvidence` stays 0/15. Category totals are multi_hop +2, single_hop -1, and temporal -1. This is source-readiness and answer-policy replay evidence, not LoCoMo default-profile promotion or public-claim movement.
- Latest LoCoMo effective answer-policy and context diagnostic (Phase 65): `analyze:phase-65-locomo-live-delta` now records per-question effective scoped prompt policy, answer context mode changes, and `answerChangeAttribution` objects. New smoke/reanswer rows also persist optional raw `answerTokenF1`, live-delta baseline/candidate side records preserve it, and the new `answerTokenF1NearMiss` reanswer bucket routes non-adversarial wrong rows whose candidate token-F1 is above zero but below the pass threshold for answer-contract and label-compatibility review without changing boolean correctness. For compatible historical live reports that predate only the token-F1 field, the live-delta CLI backfills missing `answerTokenF1` in memory from the report `benchmarkSource` / external root before writing derived artifacts, and rejects output paths that would overwrite the benchmark `cases.json` source before loading it, without rewriting source reports or rerunning answer generation; older reports that also lack required compatibility metadata such as `answerContextMode` still fail fast. The refreshed multi_hop candidate-admission delta `locomo-multihop-candidate-admission-rel08-token-f1-delta-current/live-delta.json` proves the path on real reports: same 28-row source pair, +4 net answers, 10 diagnostic `answerTokenF1NearMisses`, and 8 unique `answerTokenF1NearMiss` replay ids after noisy-full-recall priority de-duplication. The follow-up normal-context replay `locomo-multihop-answer-token-f1-near-miss-reanswer-current` reran those 8 ids with `executionFailures: 0` and scored 0/8; replay raw token-F1 averaged 0.2515 versus 0.2621 in the source near-miss queue, so simple reanswering does not recover the bucket. The subset-aware delta `locomo-multihop-answer-token-f1-near-miss-reanswer-delta-current/live-delta.json` now compares the full source report to that 8-row replay via preserved `sourceReport` lineage: 0 improvements, 0 regressions, 8 same-wrong, no retrieval/noise delta, and 7 rows still queued as `answerTokenF1NearMiss`. The near-miss label analysis `locomo-multihop-answer-token-f1-near-miss-label-analysis-current/near-miss-label-analysis.json` joins those 7 rows back to the benchmark source and classifies them as 5 balanced partial overlaps, 1 over-specified answer, 1 under-specified answer, 0 numeric/frequency-format rows, with 0 full-recall, 5 partial-recall, and 2 zero-recall rows; average replay token-F1 is 0.2874722639. That artifact now carries reusable top-level/category `questionIds`, candidate `sourceReports` lineage, plus four `repairJobs` grouped by diagnosis and partial/zero retrieval, and `locomo-multihop-near-miss-label-file-loader-smoke-current` consumed it as a 7-question retrieval-only selection with `executionFailures: 0`; default retrieval found 0/7 fully retrieved, average evidence recall 0, and 31 noise turns, so this is queue/loader proof rather than retrieval recovery. Summary counts separate answer changes that overlap retrieval-metric changes, effective prompt-policy changes, answer-context-mode changes, or residual live answer changes where none of those observable drivers changed. The regenerated open_domain-scoped single_hop/multi_hop/temporal slice deltas all have `effectiveAnswerPolicyChangedCount: 0` across their 15-question slices; multi_hop's -1 net and temporal's mixed tie are therefore live-repeatability/validation-risk evidence under unchanged effective prompt policy, not proof that scoped commonsense/strict instructions caused those answer changes. In contrast, `locomo-open-domain-rel08-vs-commonsense-strict-live-delta-current/live-delta.json` has `effectiveAnswerPolicyChangedCount: 96`, so its +4 net remains the real open_domain scoped commonsense prompt-policy signal. The answer-context-mode counters and answer-change attribution counts serve the same attribution role for `--gold-evidence-only-context` noise-isolation comparisons. Live-delta artifacts also emit candidate-sourced `reanswerJobs` for top noisy full-recall wrong rows, answer regressions, improvements, unconverted retrieval gains, and residual live answer changes; diagnostic arrays can overlap, but exported jobs are priority-assigned with unique question ids across buckets and carry selected category metadata plus source report provenance and a top-level `sourceReports` entry for the candidate report. Follow-up row validation is reproducible through the existing `--question-id-file` path; `--reanswer-job-bucket noisyFullRecallWrong` can isolate the gold-evidence-only noise subset, `--reanswer-job-bucket answerTokenF1NearMiss` can isolate token-F1 near misses, `--reanswer-job-category` can isolate a QA category, category-only replay works for answer-policy slice manifests whose `reanswerJobs` are bucketless, and filtered replay narrows same-category multi-source manifests to jobs matching the supplied `--source-report` while unfiltered manifest replay still rejects mixed-source jobs.
- Phase 65 focused multi_hop near-miss live-answer validation note: the 10-row rel0.8 multi_hop near-miss queue now has a same-provider live comparison. Provider-only live baseline `locomo-multihop-near-miss-provider-baseline-live-10row-timeout15-current` scored 0/10 with average evidence recall 0, 0/10 fully retrieved, 44 noise turns, and `executionFailures: 0`; rel0.8 semantic admission `locomo-multihop-near-miss-rel08-live-10row-timeout15-current` also scored 0/10 but raised evidence recall to 0.4142857143, found 2/10 fully retrieved rows, and carried 107 noise turns with `executionFailures: 0`. The paired live-delta `locomo-multihop-near-miss-provider-vs-rel08-live-10row-timeout15-delta-current/live-delta.json` records answer delta 0, 10 same-wrong rows, +2 fully retrieved, +63 noise turns, 7 unconverted retrieval gains, 2 full-recall noisy wrong rows, and 9 `answerTokenF1NearMisses`. The current label artifact `locomo-multihop-near-miss-rel08-live-10row-timeout15-label-analysis-current/near-miss-label-analysis.json` classifies those 9 near misses at average token-F1 0.2652996301 and average declared-evidence support 0.6553631554: 6 balanced partial overlaps, 1 numeric/frequency-format, 1 over-specified, 1 under-specified, with 2 full-recall, 5 partial-recall, and 2 zero-recall rows. This confirms the targeted admission lever helps retrieval on the selected queue but has not yet converted answer correctness; next work is answer synthesis, label-compatibility, and noise control, not default-profile promotion or public-claim movement.
- Phase 65 focused multi_hop near-miss gold-evidence-only replay note: `locomo-multihop-near-miss-rel08-live-10row-timeout15-gold-only-current` reanswered the 9 token-F1 near-miss rows from the rel0.8 live queue using only retrieved gold evidence turns in the answer context, without rerunning retrieval. It scored 1/9 (0.1111111111) with `executionFailures: 0`, preserving the same average evidence recall 0.4603174603, 2/9 fully retrieved rows, and 95 noise turns as the selected source subset. The paired delta `locomo-multihop-near-miss-rel08-live-10row-timeout15-normal-vs-gold-only-delta-current/live-delta.json` records +1 answer, 0 regressions, no retrieval/noise delta, and the single improvement `conv-42:q76` under `partial->partial` recall; the answer change is attributed to `answerContextMode` only. The follow-up label artifact `locomo-multihop-near-miss-rel08-live-10row-timeout15-gold-only-label-analysis-current/near-miss-label-analysis.json` leaves 6 near misses at average token-F1 0.3473556944 and average declared-evidence support 0.5997113997: 5 balanced partial overlaps and 1 under-specified answer, with 2 full-recall and 4 partial-recall rows. This shows gold-only context can recover one partial-evidence row but does not broadly solve the near-miss queue; remaining work stays in answer synthesis, label compatibility, and candidate admission rather than default-profile promotion.
- Phase 65 residual near-miss queue loader proof: `locomo-multihop-near-miss-gold-only-label-file-loader-smoke-current` consumed the 6-row residual gold-only label artifact with `executionFailures: 0`, while default retrieval found 0 evidence recall, 0/6 fully retrieved, and 29 noise turns. Filtered loader proofs cover every emitted repair job: `locomo-multihop-near-miss-gold-only-label-balanced-full-loader-smoke-current` selects the 2 balanced/full rows and finds 0 recall with 9 noise turns; `locomo-multihop-near-miss-gold-only-label-balanced-partial-loader-smoke-current` selects the 3 balanced/partial rows and finds 0 recall with 14 noise turns; `locomo-multihop-near-miss-gold-only-label-under-specified-partial-loader-smoke-current` selects the 1 under-specified/partial row and finds 0 recall with 6 noise turns. This makes the residual queue reproducible for targeted repair, and confirms default retrieval cannot recover it without candidate admission.
- Phase 65 residual near-miss rel0.8 candidate-admission proof: the same 6-row residual queue now has a provider-backed retrieval comparison. Provider-only baseline `locomo-multihop-near-miss-gold-only-label-provider-baseline-6row-timeout15-current` found 0 average evidence recall, 0/6 fully retrieved, 29 noise turns, and `executionFailures: 0`; rel0.8 semantic admission `locomo-multihop-near-miss-gold-only-label-rel08-retrieval-6row-timeout15-current` reached 0.6071428571 average evidence recall, 2/6 fully retrieved, 67 noise turns, and `executionFailures: 0`. The paired budget delta `locomo-multihop-near-miss-gold-only-label-provider-vs-rel08-retrieval-6row-timeout15-delta-current/budget-delta.json` records +0.6071428571 recall, +2 fully retrieved, +38 noise turns, and 1.5977443609 recall per 100 added noise turns. This is targeted retrieval repair evidence for the residual queue only; it is not live-answer score movement, default-profile promotion, or public-claim evidence.
- Latest LoCoMo candidate-admission repair queues (Phase 65): `analyze:phase-65-locomo-candidate-admission-slice` now writes deterministic question-level manifests from paired baseline/candidate reports. Rel0.8 retrieval-only selection produced `locomo-open-domain-candidate-admission-slice-rel08-current` with 22 selected questions (6 full-retrieval gains, 6 partial gains still missing, 10 stubborn missing; 65 stubborn-missing rows available) and `locomo-multihop-candidate-admission-slice-rel08-current` with 28 selected questions (8 full-retrieval gains, 10 partial gains still missing, 10 stubborn missing; 197 stubborn-missing rows available). The open_domain live-aware manifest `locomo-open-domain-live-candidate-admission-slice-rel08-current` selects 32 questions and exposes 15 available noisy full-recall wrong rows, selecting 10. Candidate manifests also emit `reanswerJobs` for selected candidate-side full-recall noisy wrong rows, including selected rows whose primary repair bucket is a retrieval-gain bucket, and expose top-level `sourceReports` candidate-report lineage; in reanswer-mode manifest loading, file-local `reanswerJobs` take strict precedence over top-level `questionIds`, broader `repairJobs`, and category fallbacks, and an explicitly empty preferred `reanswerJobs` queue fails instead of falling back to broader queues, while explicit CLI `--question-id` values remain additive. This keeps gold-evidence-only noise isolation from accidentally replaying broader missing-evidence queues. Selected jobs must carry `sourceRunId` or `sourceReportPath`; reanswer replay rejects missing job-level source provenance, mismatched `--source-report` run ids, mismatched source report paths, mixed-source selected jobs, non-string selected question ids, invalid or mismatched `questionCount` values, missing `candidateReport` / `sourceReports` runId-or-path identities, duplicate selected `sourceReports` lineage, and manifest-internal `candidateReport` / selected `sourceReports` provenance conflicts before loading the benchmark root, while category-filtered answer-policy replay may ignore unrelated top-level `sourceReports` from other categories. Generated reanswer smoke reports persist `sourceReport` lineage with retrieval-config metadata plus `reanswerSelection` metadata for explicit ids, manifest path, bucket filters, and category filters for later audit; shared report validation also rejects reanswer artifacts that carry selected `questionIds` without either explicit ids or the manifest path that selected them, preserve a manifest path without selected question ids or job filters, or declare explicit ids/job filters without a top-level selected `questionIds` header. Bucket/category-filtered replay can target one named `reanswerJobs` queue and one QA category, and hard answer-generation failures keep their selected rows with null answer fields plus `executionFailures`. The runner now consumes these queues via `--question-id-file` and rejects duplicate `--case-id` / `--category` smoke scope filters before report generation; retrieval-only file-loader smokes loaded both manifests with `executionFailures: 0`: `locomo-open-domain-candidate-admission-file-loader-smoke-current` loaded the 22-question open_domain manifest, and `locomo-multihop-candidate-admission-file-loader-smoke-current` loaded the 28-question multi_hop manifest at 0.4702380952 evidence recall, 8/28 fully retrieved, and 282 noise turns. These are targeted repair queues, not default-promotion evidence or LoCoMo closure.
- Latest LoCoMo open_domain full-recall noise-isolation replay (Phase 65): current targeted live source `locomo-open-domain-full-recall-wrong-live-strict-current` reran 13 strict open_domain full-recall wrong rows with topK32/maxAdditions8/rel0.8, commonsense, strict no-evidence abstention, and evidence-pack context. It scored 3/13 with average evidence recall 1, 13/13 fully retrieved, 112 noise turns, and `executionFailures: 0`. Same-context reanswer `locomo-open-domain-full-recall-wrong-reanswer-normal-current` scored 1/13; delta `locomo-open-domain-full-recall-wrong-normal-delta-current/live-delta.json` shows -2 net from residual live-answer changes under unchanged retrieval/context/policy. Gold-evidence-only replay `locomo-open-domain-full-recall-wrong-reanswer-gold-only-current` scored 4/13; delta `locomo-open-domain-full-recall-wrong-gold-only-delta-current/live-delta.json` shows +1 net (2 improvements, 1 regression), all rows full->full, and answer-context-mode attribution for all answer changes. The residual near-miss analysis `locomo-open-domain-full-recall-wrong-gold-only-near-miss-label-analysis-current` classified 4 full-recall rows as 3 rationale-bearing gold-answer rows, 0 under-specified, 0 numeric/frequency-format, and 1 balanced partial-overlap, with average token-F1 0.2470619658; the classifier now gives answer-token subsets with nonnumeric missing rationale their own label-compatibility bucket instead of misrouting them as under-specified or numeric/frequency issues. The artifact emits full-recall repair jobs for the 3-row rationale-bearing bucket and the 1-row balanced bucket. Broad loader smoke `locomo-open-domain-full-recall-wrong-gold-only-near-miss-label-file-loader-smoke-current` consumed the queue with `executionFailures: 0`, while default retrieval found only 1/4 fully retrieved, average evidence recall 0.25, and 11 noise turns. The smoke runner can now filter those repair jobs by diagnosis and retrieval bucket; `locomo-open-domain-rationale-bearing-full-repair-file-loader-smoke-current` selected the three rationale-bearing/full rows (`conv-26:q64`, `conv-42:q60`, `conv-26:q22`) with `executionFailures: 0`, while default retrieval found 0/3 evidence recall and 9 noise turns. Noise stripping helps selected rows but is not stable or broad enough for default promotion; the residual queue mixes rationale-bearing gold label work with default-retrieval gaps and one closed-world / no-positive-evidence edge.
- Phase 65 targeted smoke selection-lineage note: targeted `eval:phase-65-smoke` reports now persist `questionSelection` for explicit question ids, manifest paths, and repair-job filters, and shared report validation rejects malformed present lineage. The regenerated `locomo-open-domain-rationale-bearing-full-repair-file-loader-smoke-current` report records the near-miss manifest path plus `repairJobDiagnoses=["rationale-bearing-gold-answer"]` and `repairJobRetrievalBuckets=["full"]`. This is auditability hardening only; it does not change LoCoMo scores, default status, or public-claim boundaries.
- Latest LoCoMo open_domain unconverted retrieval-gain probe (Phase 65): because the older full-root rel0.8 live report predates required answer-context lineage, the nine `topUnconvertedRetrievalGains` ids were rerun as `locomo-open-domain-top-unconverted-rel08-source-current` with topK32/maxAdditions8/rel0.8, live evidence-pack answers, 0/9 accuracy, average evidence recall 0.6851851852, 4 fully retrieved, 90 noise turns, and `executionFailures: 0`. Gold-evidence-only replay `locomo-open-domain-top-unconverted-reanswer-gold-only-current` recovered 1/9 with identical retrieval metrics; delta `locomo-open-domain-top-unconverted-normal-vs-gold-only-delta-current/live-delta.json` shows +1, 0 regressions, and 8 same-wrong. The first same-source commonsense replay stayed at 0/9 because the system allowed open_domain commonsense while the user prompt still said to answer using only dialog context. The current prompt aligns that path and asks for the requested type directly; `locomo-open-domain-top-unconverted-reanswer-commonsense-bridge-current` recovered 1/9 with no regressions, while a grounding-phrase variant was rejected after `locomo-open-domain-top-unconverted-reanswer-commonsense-bridge-grounded-current` fell back to 0/9. This is a narrow answer-contract win, not closure: the open_domain unconverted-gain blocker still routes to targeted admission plus answer/context organization and label-compatibility review.
- Latest LoCoMo multi_hop candidate-admission live validation (Phase 65): after `prepare:phase-65-locomo` was fixed to canonicalize upstream legacy QA evidence ids such as `D:11:26` to `D11:26`, `/private/tmp/LOCOMO-full/cases.json` was regenerated with 10 cases, 1986 questions, 5882 turns, and no remaining `D:<session>:<turn>` evidence ids. The normalized same-scope 28-row multi_hop manifest now has clean live evidence: topK16/maxAdditions4 `locomo-multihop-candidate-admission-top16-add4-live-evidence-normalized-current` scored 6/28 (0.2142857143), average evidence recall 0.1833333333, 0 fully retrieved, noise 220, `executionFailures: 0`; topK32/maxAdditions8/rel0.8 `locomo-multihop-candidate-admission-rel08-live-evidence-normalized-current` scored 10/28 (0.3571428571), average evidence recall 0.4753401361, 8 fully retrieved, noise 281, `executionFailures: 0`. The live-delta `locomo-multihop-top16-add4-vs-candidate-admission-rel08-live-delta-evidence-normalized-current/live-delta.json` shows +4 net correct answers (5 improved, 1 regressed), +0.2920068027 evidence recall, +8 fully retrieved, +61 noise turns, 5 converted retrieval gains, and 9 unconverted retrieval gains. This is positive targeted-admission evidence plus residual answer/noise risk, not a defaultable LoCoMo setting.
- Latest LoCoMo rel0.8 multi_hop near-miss queue expansion (Phase 65): after regenerating `/private/tmp/LOCOMO-full/cases.json`, `locomo-multihop-candidate-admission-rel08-near-miss-label-analysis-current/near-miss-label-analysis.json` labels all 10 `answerTokenF1NearMisses` from `locomo-multihop-candidate-admission-rel08-token-f1-delta-current`: average candidate token-F1 0.2429793770, 7 balanced partial overlaps, 1 over-specified answer, 2 under-specified answers, 0 rationale-bearing/numeric/zero-overlap rows, with 2 full-recall, 5 partial-recall, and 3 zero-recall rows. Its six repair jobs split balanced-partial-overlap full/partial/zero rows, over-specified partial rows, and under-specified partial/zero rows. Loader proof `locomo-multihop-candidate-admission-rel08-near-miss-label-file-loader-smoke-current` consumed the 10-question artifact with `executionFailures: 0`; default retrieval found 0/10 fully retrieved, average evidence recall 0, and 44 noise turns. The provider-only timeout15 baseline `locomo-multihop-near-miss-provider-baseline-10row-timeout15-current` reproduced that 0 recall with provider embeddings, while the rel0.8 semantic-admission retry `locomo-multihop-near-miss-rel08-retrieval-10row-timeout15-current` completed with `executionFailures: 0`, average evidence recall 0.4142857143, 2/10 fully retrieved, and 107 noise turns. The paired budget delta `locomo-multihop-near-miss-provider-vs-rel08-timeout15-retrieval-delta-current/budget-delta.json` records +0.4142857143 recall, +2 fully retrieved, +63 noise turns, and 0.6575963719 recall per 100 added noise turns. This is positive targeted candidate-admission evidence for the near-miss queue, but it is retrieval-only and still requires answer/label validation before any default-profile promotion.
- Latest LoCoMo multi_hop full-recall answer-contract probe (Phase 65): the same normalized live-delta exported a three-row `noisyFullRecallWrong` queue. Normal-context and gold-evidence-only reanswers both scored 0/3 before the prompt repair, so removing retrieved noise alone did not recover the rows. The live prompt now includes a generic count/frequency contract for how-many-times answers (`twice` instead of bare `2`); with that prompt, `locomo-multihop-noisy-full-recall-reanswer-frequency-normal-current` scored 1/3 and `locomo-multihop-noisy-full-recall-reanswer-frequency-gold-only-current` also scored 1/3, both at full evidence recall and `executionFailures: 0`. The delta `locomo-multihop-noisy-full-recall-frequency-normal-vs-gold-only-delta-current/live-delta.json` shows 0 net answer change from gold-only context, with 1 same-correct and 2 same-wrong. This is a narrow answer-contract win and points the remaining multi_hop full-recall misses toward answer-synthesis / label-compatibility work, not plain noise stripping.
- Latest LoCoMo multi_hop answer-synthesis focused replay (Phase 65): after adding the category-scoped multi_hop synthesis prompt guard, the same three-row `noisyFullRecallWrong` queue was rerun as `locomo-multihop-noisy-full-recall-reanswer-synthesis-current` with `executionFailures: 0`. It scored 1/3, matching the earlier frequency-contract replay; the subset-aware delta against the rel0.8 source report, `locomo-multihop-noisy-full-recall-reanswer-synthesis-delta-current/live-delta.json`, shows +1 answer, 0 regressions, no retrieval/noise delta, and two remaining token-F1 near misses. The near-miss label analysis `locomo-multihop-synthesis-near-miss-label-analysis-current/near-miss-label-analysis.json` classifies both remaining rows (`conv-48:q83`, `conv-49:q29`) as balanced partial-overlap answers with candidate full evidence recall and average token-F1 0.2660818713; the loader proof `locomo-multihop-synthesis-near-miss-label-file-loader-smoke-current` consumed that artifact as a 2-question retrieval-only selection with `executionFailures: 0`, while default retrieval found 0/2 fully retrieved, average evidence recall 0, and 9 noise turns. This validates that the current prompt stack preserves the narrow full-recall win and leaves a reusable answer-synthesis / label-compatibility queue, but it does not close the queue or justify default promotion.
- Latest LoCoMo multi_hop unconverted retrieval-gain probe (Phase 65): the same normalized live-delta exported a five-row `topUnconvertedRetrievalGains` queue, all partial-recall gains. Normal replay over the rel0.8 candidate context, `locomo-multihop-top-unconverted-reanswer-normal-current`, scored 1/5 with average evidence recall 0.5, 0 fully retrieved, 56 noise turns, and `executionFailures: 0`; `locomo-multihop-top-unconverted-reanswer-gold-only-current` scored 0/5 with identical retrieval metrics. Delta `locomo-multihop-top-unconverted-normal-vs-gold-only-delta-current/live-delta.json` shows -1 net from gold-only context, 0 improvements, 1 regression, 4 same-wrong, and all rows staying `partial->partial`. This routes the selected unconverted gains back to missing-evidence candidate admission and label-compatibility review, not gold-only noise stripping.
- Phase 65 manifest selected-scope guard note: targeted `--question-id-file` JSON now rejects mismatched top-level `questionIds` versus category-level `questionIds`, validates top-level/category selection-header shape, category header keys, `overall` container shape, equality, selected counts, and exact singleton `reanswerJobs` category/category-list consistency before preferred reanswer-job precedence even when the preferred queue is empty, and validates `overall.selectedQuestionCount` against repair/reanswer-job-only or preferred reanswer-job-only `questionIds` only when broader selection headers are absent or empty, including explicitly empty repair/reanswer or preferred queues, instead of silently unioning or accepting inconsistent selected scopes. This protects near-miss label and other repair artifacts from widening targeted smoke/reanswer scopes through inconsistent manifest headers or typoed category buckets.
- Phase 65 whole-report reanswer lineage note: `eval:phase-65-reanswer-report` now records inherited source `questionIds` as `reanswerSelection.explicitQuestionIds` when replaying an already-targeted source report without any additional id/file/bucket/category filter. This makes whole-report replay artifacts acceptable to shared report validation and live-delta analysis without changing LoCoMo scores, default status, or public-claim boundaries.
- Phase 65 CLI evidence guard note: shared strict scalar and boolean mode flags across smoke, reanswer, and measurement CLIs now reject duplicate source/output/run-id, budget selectors, canonical answer-policy/candidate-admission `--per-bucket` values, and repeated mode switches before report generation, reanswer question-id / bucket / category CLI lists reject empty or whitespace-padded values plus duplicate bucket/category values, multi-report `--report` lists reject empty, whitespace-padded, or duplicate normalized path values, paired baseline/candidate analyzers reject path-equivalent self-comparisons, targeted smoke/reanswer replay rejects explicit question ids that overlap selected manifest or question-id-file scopes instead of silently de-duplicating malformed replay scope, targeted manifest parsing rejects malformed repair/reanswer/category containers, non-object entries, whitespace-padded manifest question ids, malformed, empty, or whitespace-padded `reanswerJobs` source provenance, duplicate per-job `reanswerJobs` question ids, duplicate `reanswerJobs` category-list values, and malformed or unknown `reanswerJobs` selection metadata instead of silently skipping or accepting queued rows, reanswer replay rejects selected `reanswerJobs` without job-level source provenance, and filtered reanswer replay rejects non-object `reanswerJobs` entries plus malformed, duplicate, or unknown bucket/category selection metadata before bucket/category/source selection, reanswer source-lineage validation rejects malformed `candidateReport` / `sourceReports` containers, entries, provenance field types, missing runId-or-path identities, empty or whitespace-padded lineage values, duplicate selected `sourceReports` lineage, self-referential source reports, same-time or future-dated source reports, gold-evidence-only replay sources, missing reanswer source answer-context lineage, self-referential question-id-file manifests, source-report-as-question-id-file manifests, source retrieval-config conflicts, reanswer `questionIds` without explicit-id or manifest-file lineage, unused reanswer manifest paths without selected question ids or job filters, or selected reanswer scopes without a top-level `questionIds` header before matching, `eval:phase-65-smoke` rejects partial category-filter misses before report generation, shared smoke-report validation rejects malformed, empty, or whitespace-padded report `runId` values, malformed benchmark-source/external-root provenance, malformed upstream source/license/answer-metric value or coverage provenance, malformed profile lineage, malformed retrieval-config metadata, malformed replay-lineage or empty/duplicate replay-selection metadata, malformed replay-selection-to-cases lineage, malformed reanswer filter manifest lineage, malformed reanswer category-filter-to-cases lineage, malformed report provenance timestamp/writer/answer-context/policy metadata, malformed gold-evidence-only answer-context lineage, malformed or whitespace-padded reanswer-writer answer-context/source/selection lineage, malformed writer/replay-lineage ownership, malformed core `cases` / `categories` containers or entries, malformed or duplicate row retrieval arrays, malformed row scalar/metric fields, malformed or partial live-answer row answer fields, malformed category summary scalar/metric fields, malformed, whitespace-padded, or duplicate selection headers, malformed `questionCount` / `caseCount` / `executionFailures` headers, and `questionCategories` headers that overstate the actual `cases[]` categories; reanswer output generation also narrows inherited source `questionCategories` headers to the actual replayed rows, and targeted reanswer rejects empty or whitespace-padded explicit question-id scopes, blank, whitespace-padded, or source-matching output run ids, explicit-run output paths that would overwrite `--source-report` before the source report is read, reanswer-generated source reports, live-answer source reports with missing scored answer fields, source reports whose timestamp is not earlier than the replay timestamp, source reports where one queued question id matches multiple cases, source reports that are already gold-evidence-only replay artifacts, or blank generated answers that would otherwise be written as scored replay rows.
- Phase 65 neural measurement arm-list guard note: `measure-locomo-neural.ts` now rejects empty or whitespace-padded comma-separated `--arms` entries before retrieval measurement, so malformed neural/BM25 scope such as `bm25,` cannot silently shrink to a narrower evidence table. This protects evidence scope only; it does not change LoCoMo retrieval, answer scores, default settings, or public-claim boundaries.
- Phase 65 paired-analyzer lineage guard note: budget-delta, candidate-admission slice, and live-delta comparisons reject baseline/candidate reports with the same top-level `runId` even when their paths differ, and reject output paths that resolve to either input report path. This includes default output paths derived from `--candidate-report` plus `--run-id`, before source reports are read; all three paired analyzers also require `--run-id` to be a single path segment before deriving default output paths. This is derived-evidence lineage and output-directory hardening only; it does not change LoCoMo retrieval scores, answer scores, default status, or public-claim boundaries.
- Phase 65 near-miss label output guard note: `analyze:phase-65-locomo-near-miss-labels` now rejects output paths that resolve to the input `--live-delta` before reading reports, rejects paths that resolve to the live-delta `candidateReport.path` before reading that candidate source report, and rejects paths that resolve to the candidate benchmark `cases.json` before loading benchmark cases. It also requires `--run-id` to be a single path segment before deriving the default output path from `--live-delta`. Near-miss label artifacts now record `sourceReports[].questionCount` as the selected near-miss row count emitted by the artifact, not the full candidate report question count, so source lineage matches top-level `questionIds`. This prevents label diagnostics from overwriting source evidence, escaping intended derived-evidence directories, or overstating selected source scope without changing LoCoMo retrieval, answer scores, default status, or public-claim boundaries.
- Phase 65 multi-report post-processor output guard note: `summarize:phase-65-locomo-categories`, `analyze:phase-65-locomo-category-gaps`, and `analyze:phase-65-locomo-answer-policy-slice` now reject empty or whitespace-padded `--report` values and output paths that resolve to any input `--report` before reading reports. All three also require `--run-id` to be a single path segment before deriving default output paths from the first `--report`. This keeps category matrices, gap diagnostics, and answer-policy manifests from malformed source lists, overwritten source evidence, or derived-output directory traversal without changing LoCoMo retrieval, answer scores, default status, or public-claim boundaries.
- Phase 65 retrieval-gap output/source guard note: `analyze:phase-65-locomo-retrieval-gap` now rejects output paths that resolve to either its input `--report` or its resolved cases file before reading inputs, rejects ambiguous `--cases` plus `--benchmark-root` source selectors, requires output `--run-id` values to be a single path segment before deriving default output paths, and persists source report / cases source / output path lineage plus `generatedAt` and diagnostic-only `claimBoundary` in the generated analysis. This keeps retrieval-gap diagnostics from overwriting source smoke reports or external-root cases, escaping intended derived-evidence directories, silently preferring one cases source over another, or relying on run-directory names to audit provenance, without changing LoCoMo retrieval, answer scores, default status, or public-claim boundaries.
- Phase 65 captioned-root source/output guard note: `prepare:phase-65-locomo-captioned` now rejects output roots that resolve to the input source root before reading cases, and rejects empty or whitespace-padded `GOODMEMORY_LOCOMO_ROOT` values before source-root fallback. This keeps captioned-root fixture prep from overwriting the normalized external LoCoMo root or reading malformed env-derived source roots without changing LoCoMo retrieval, answer scores, default status, or public-claim boundaries.
- Phase 65 external-root prep source intake/output guard note: `prepare:phase-65-locomo` now rejects ambiguous `--source-file` plus `--source-url` selectors, rejects `--source-file` values that resolve to the normalized output `--output-root/cases.json` before reading the source file, rejects non-OK `--source-url` fetch responses before JSON parsing, and rejects empty or whitespace-padded `GOODMEMORY_LOCOMO_ROOT` values before output-root resolution. This keeps external-root prep from silently preferring one source, keeps local raw LoCoMo source fixtures from being overwritten by generated normalized cases, prevents remote error pages from becoming source data, and surfaces malformed env-derived output roots without changing LoCoMo retrieval, answer scores, default status, or public-claim boundaries.
- Phase 65 shared row-identity guard note: shared smoke-report validation now rejects whitespace-padded `cases[]` row `caseId` and `questionId` values before selection-header matching or question-delta joins, so malformed row identities surface as canonicality errors instead of later `caseIds` or question mismatch errors.
- Phase 65 shared run-directory guard note: shared smoke-report validation now rejects whitespace-padded `runDirectory` provenance before category-gap or other downstream analyzers preserve report output-directory lineage.
- Phase 65 shared benchmark-source guard note: shared smoke-report validation now rejects whitespace-padded `benchmarkSource` and `externalRoot` provenance before path compatibility checks, so malformed benchmark-root lineage surfaces as canonicality errors instead of later source/root mismatch errors.
- Phase 65 shared reanswer-manifest guard note: shared smoke-report validation now rejects whitespace-padded `reanswerSelection.questionIdFile` provenance before replay-selection lineage and self/source manifest checks.
- Phase 65 shared row-category guard note: shared smoke-report validation now rejects whitespace-padded `cases[]` row `category` values before category enum checks, category-gap aggregation, or matrix assembly.
- Phase 65 shared timestamp guard note: shared smoke-report validation now rejects whitespace-padded top-level `generatedAt` and nested `sourceReport.generatedAt` values before ISO parsing, replay timestamp ordering, or derived analyzer lineage.
- Phase 65 shared exact-provenance guard note: shared smoke-report validation now rejects whitespace-padded `generatedBy`, `license`, `upstreamSource`, and `upstreamAnswerMetricByCategory.*` values before writer/source/license allow-list checks or answer-metric comparisons.
- Phase 65 shared upstream metric category-key guard note: shared smoke-report validation now rejects whitespace-padded `upstreamAnswerMetricByCategory` category keys before category allow-list checks or coverage comparisons against `cases[]` categories.
- Phase 65 shared answer-context-mode guard note: shared smoke-report validation now rejects whitespace-padded top-level `answerContextMode` and nested `sourceReport.answerContextMode` values before enum support checks, replay writer compatibility checks, or answer-context delta attribution.
- Phase 65 shared answer-context-mode shape guard note: shared smoke-report validation now rejects non-string or empty top-level `answerContextMode` and nested `sourceReport.answerContextMode` values before enum support checks, replay writer compatibility checks, or answer-context delta attribution.
- Phase 65 shared semantic embedding-source guard note: shared smoke-report validation now rejects whitespace-padded top-level `semanticCandidateEmbeddingSource` and nested `sourceReport.retrievalConfig.semanticCandidateEmbeddingSource` values before enum support checks, retrieval-config compatibility checks, or derived analyzer lineage.
- Phase 65 shared semantic embedding-source shape guard note: shared smoke-report validation now rejects non-string or empty `semanticCandidateEmbeddingSource` values before enum support checks, retrieval-config compatibility checks, or derived analyzer lineage.
- Phase 65 shared report identity/mode guard note: shared smoke-report validation now rejects whitespace-padded `benchmark`, `phase`, `mode`, `ingestMode`, and `answerEvaluation` values before benchmark/phase identity checks, supported mode checks, or mode/evaluation pairing checks.
- Phase 65 shared report identity/mode shape guard note: shared smoke-report validation now rejects non-string or empty `benchmark`, `phase`, `mode`, `ingestMode`, and `answerEvaluation` values before benchmark/phase identity checks, supported mode checks, or mode/evaluation pairing checks.
- Phase 65 shared optional selection-header non-empty guard note: shared smoke-report validation now rejects empty `questionIds` and `questionCategories` arrays before selection-header matching against `cases[]`.
- Phase 65 shared caseIds header non-empty guard note: shared smoke-report validation now rejects empty `caseIds` arrays before `caseCount` or `cases[]` header matching.
- Phase 65 semantic-candidate/BM25 mode guard note: `eval:phase-65-smoke` rejects `--semantic-candidates` combined with `--bm25` before memory construction or report generation, preserving BM25 as the embedding-free lexical leg and semantic candidate admission as embedding-backed evidence.
- Phase 65 shared BM25 embedding-source guard note: shared smoke-report validation now rejects reports that set `bm25Ranking: true` while claiming a `semanticCandidateEmbeddingSource` other than `none`.
- Phase 65 shared semantic-candidate/source consistency guard note: shared smoke-report validation now rejects `semanticCandidates.enabled=true` with `semanticCandidateEmbeddingSource="none"`, including nested `sourceReport.retrievalConfig` lineage, before analyzer attribution or replay lineage checks.
- Phase 65 semantic-candidate inactive-budget guard note: `eval:phase-65-smoke` rejects semantic-candidate tuning flags unless `--semantic-candidates` is enabled, and shared smoke-report validation rejects non-null semantic-candidate tuning fields when `semanticCandidates.enabled=false`, including nested `sourceReport.retrievalConfig` lineage.
- Phase 65 answer-policy live-mode guard note: `eval:phase-65-smoke` rejects `--allow-commonsense-resolution` and `--strict-no-evidence-abstention` unless `--live` is enabled, and shared smoke-report validation rejects retrieval-only reports that carry those live-only answer-policy flags.
- Phase 65 answer-context live-mode guard note: `eval:phase-65-smoke` rejects `--answer-from-recalled` and `--evidence-pack` unless `--live` is enabled, and shared smoke-report validation rejects retrieval-only reports whose `answerContextMode` is not `raw-turns`.
- Phase 65 multi-hop answer-synthesis prompt guard note: LoCoMo live/reanswer generation now adds a category-scoped `multi_hop` system instruction to compose the final answer from every required evidence link and avoid stopping at a first matching clue or partial chain. This targets the current multi_hop answer-contract / label-compatibility queue as deterministic prompt hardening only; it does not change LoCoMo retrieval scores, accepted evidence, default status, or public-claim boundaries until a focused live slice proves a score change.
- Phase 65 reanswer category-filter source-row guard note: `eval:phase-65-reanswer-report` rejects category-filtered manifest replay when a selected source report row's actual QA category does not match the requested `--reanswer-job-category`. This prevents an answer-policy or noise-isolation manifest typo from replaying, for example, an adversarial row inside an open_domain repair queue. This is targeted replay evidence isolation only; it does not change LoCoMo retrieval scores, answer scores, default status, or public-claim boundaries.
- Phase 65 shared zero-failure live-answer completeness guard note: shared smoke-report validation now rejects live-answer reports with `executionFailures: 0` when any row is missing scored answer fields, while still allowing non-zero-failure live reports to retain failed rows with null answer fields.
- Phase 65 shared answer-token-F1 state guard note: shared smoke-report validation now rejects failed live-answer and retrieval-only rows that carry a non-null `answerTokenF1`; only rows with both `answerCorrect` and `generatedAnswer` present may carry a numeric token-F1, while legacy live-answer reports may still omit the field or use null for in-memory backfill. This protects token-F1 near-miss routing evidence without changing LoCoMo scores, default status, or public-claim boundaries.
- Phase 65 shared row turn-id syntax guard note: shared smoke-report validation now rejects row `evidenceTurnIds`, `retrievedTurnIds`, `missingEvidenceTurnIds`, and `noiseTurnIds` entries that are not canonical LoCoMo `dia_id` values of the form `D<session>:<turn>`.
- Phase 65 shared profile lineage guard note: shared smoke-report validation now rejects `profilesCompared` values that differ from the canonical `["goodmemory-rules-only"]` lineage written by Phase 65 LoCoMo reports.
- Phase 65 shared present category-summary metrics guard note: shared smoke-report validation now rejects any present `categories[]` summary whose aggregate metrics disagree with `cases[]`, while still allowing diagnostics to omit category summaries entirely and full smoke shards that carry zero-count summaries for absent categories.
- Phase 65 shared explicit-only reanswer lineage guard note: shared smoke-report validation now rejects reanswer reports whose `reanswerSelection.explicitQuestionIds` do not match top-level `questionIds` when no manifest path or reanswer job filters are present, while still allowing explicit ids to be additive with manifest-backed jobs.
- Phase 65 shared category-summary guard note: shared smoke-report validation now rejects whitespace-padded `categories[]` summary `category` values before category enum checks, category-summary comparisons, budget-delta analysis, or matrix assembly.
- Phase 65 shared generated-answer guard note: shared smoke-report validation now rejects whitespace-padded live-answer row `generatedAnswer` values before category-gap aggregation, live-delta comparison, or replay-derived analyzer export.
- Latest LoCoMo full-root multi_hop blocker proof (Phase 65): `locomo-multihop-semantic-provider-top16-add4-current` covers all 282 multi-hop questions across 10 conversations with evidence-turn recall 0.326, 37/282 fully retrieved, noise 2204, `executionFailures: 0`, and `questionCategories=["multi_hop"]`; the live evidence-pack validation `locomo-multihop-semantic-provider-top16-add4-live-pack-current` scores 86/282 answer accuracy (0.305), `executionFailures: 0`. This upgrades the multi-hop blocker from held-out-shard evidence to measured full-root category evidence; LoCoMo remains not closed.
- Latest LoCoMo full-root temporal proof (Phase 65): `locomo-temporal-semantic-provider-top16-add4-current` covers all 321 temporal questions across 10 conversations with evidence-turn recall 0.678, 207/321 fully retrieved, noise 2571, `executionFailures: 0`, and `questionCategories=["temporal"]`; the resumed live evidence-pack validation `locomo-temporal-semantic-provider-top16-add4-live-pack-current` scores 178/321 answer accuracy (0.555), `executionFailures: 0`. Temporal is less retrieval-starved than open_domain or multi_hop, but remains answer-side weak, especially conv-42 8/40 and conv-44 11/24.
- Latest LoCoMo full-root adversarial/no-answer proof (Phase 65): `locomo-adversarial-semantic-provider-top16-add4-current` covers all 446 adversarial questions across 10 conversations with evidence-turn recall 0.592, 260/446 fully retrieved, noise 3421, `executionFailures: 0`, and `questionCategories=["adversarial"]`; live validation `locomo-adversarial-semantic-provider-top16-add4-live-pack-current` scores 240/446 answer accuracy (0.538), `executionFailures: 0`. This measures the no-answer policy blocker at full-root scope; it does not close adversarial behavior.
- Latest LoCoMo full-root single_hop proof (Phase 65): `locomo-single-hop-semantic-provider-top16-add4-current` covers all 841 single-hop questions across 10 conversations with evidence-turn recall 0.676, 558/841 fully retrieved, noise 6343, `executionFailures: 0`, and `questionCategories=["single_hop"]`; resumed live validation `locomo-single-hop-semantic-provider-top16-add4-live-pack-current` scores 457/841 answer accuracy (0.543), `executionFailures: 0`. This feeds the assembled full-root category evidence matrix, not LoCoMo performance.

## Phase 40 Release Evidence

- Phase 40 is now closed as the v0.2 release proof and product eval slice.
- cross-consumer adoption smoke covers direct TypeScript, Express, Fastify, Python/FastAPI bridge, and installed-host package paths: `reports/eval/adoption/phase-40/run-20260425163012-cross-consumer/report.json`
- product eval rollup compares with-GoodMemory against a no-memory baseline: `reports/eval/product/phase-40/run-20260425165544-product-eval/report.json`
- Quality gate: `reports/quality-gates/phase-40/run-20260425172323/phase-40-quality-gate.json`

## Historical Evidence Index

This index keeps one-line evidence pointers instead of old narrative.

- Phase 20: `docs/archive/quality-gates/GoodMemory-Phase-20-Quality-Gate.md`, `reports/quality-gates/phase-20/run-20260420023503/phase-20-quality-gate.json`.
- Phase 22: `docs/archive/quality-gates/GoodMemory-Phase-22-Quality-Gate.md`, `reports/eval/live-memory/phase-22/run-1776650772564-assist/report.json`.
- Phase 23: `docs/archive/quality-gates/GoodMemory-Phase-23-Quality-Gate.md`, `reports/eval/live-memory/phase-23/run-1776658376536-promote/report.json`.
- Phase 29: `docs/archive/quality-gates/GoodMemory-Phase-29-Quality-Gate.md`, `reports/quality-gates/phase-29/run-20260421213000/phase-29-quality-gate.json`, `reports/quality-gates/phase-29/run-20260421214500/phase-29-rc-dry-run.json`.
- Phase 30: `docs/archive/quality-gates/GoodMemory-Phase-30-Quality-Gate.md`, `reports/quality-gates/phase-30/run-20260421153410/phase-30-quality-gate.json`, `reports/eval/live-memory/phase-30/run-phase30-live-current/report.json`.
- Phase 31: `docs/archive/quality-gates/GoodMemory-Phase-31-Quality-Gate.md`, `reports/quality-gates/phase-31/run-20260422041616/phase-31-quality-gate.json`, `reports/eval/live-memory/phase-31/run-phase31-live-current/report.json`.
- Phase 32: `docs/archive/quality-gates/GoodMemory-Phase-32-Quality-Gate.md`, `reports/quality-gates/phase-32/run-20260422085720/phase-32-quality-gate.json`, `reports/eval/fallback/phase-32/run-20260422173045/report.json`, `reports/eval/live-memory/phase-32/run-phase32-live-current/report.json`.
- Phase 33: `docs/archive/quality-gates/GoodMemory-Phase-33-Quality-Gate.md`, `reports/quality-gates/phase-33/run-20260422212752/phase-33-quality-gate.json`.
- Phase 34: `docs/archive/quality-gates/GoodMemory-Phase-34-Quality-Gate.md`, `reports/eval/fallback/phase-34/run-20260422213045/report.json`, `reports/eval/live-memory/phase-34/run-phase34-live-current/report.json`, `reports/quality-gates/phase-34/run-20260423102636/phase-34-quality-gate.json`.
- Phase 35: `docs/archive/quality-gates/GoodMemory-Phase-35-Quality-Gate.md`, `reports/eval/fallback/phase-35/run-20260423173045/report.json`, `reports/eval/live-memory/phase-35/run-phase35-live-current/report.json`, `reports/quality-gates/phase-35/run-20260423213045/phase-35-quality-gate.json`.
- Phase 36: `docs/archive/quality-gates/GoodMemory-Phase-36-Quality-Gate.md`, `reports/quality-gates/phase-36/run-20260423223045/phase-36-quality-gate.json`.
- Phase 37: `docs/archive/quality-gates/GoodMemory-Phase-37-Quality-Gate.md`, `reports/eval/fallback/phase-37/run-20260424101045/report.json`, `reports/eval/live-memory/phase-37/run-phase37-live-current/report.json`, `reports/eval/live-memory/phase-37/run-phase37-external-consumer/report.json`, `reports/quality-gates/phase-37/run-20260424104045/phase-37-quality-gate.json`.
- Phase 37.1: `docs/archive/quality-gates/GoodMemory-Phase-37.1-Quality-Gate.md`, `reports/eval/dogfood/phase-37-1/run-phase37-1-dogfood-current/report.json`, `reports/quality-gates/phase-37-1/run-20260424100757/phase-37-1-quality-gate.json`.
- Phase 38: `docs/archive/quality-gates/GoodMemory-Phase-38-Quality-Gate.md`, `reports/quality-gates/phase-38/run-20260425084045/phase-38-quality-gate.json`.
- Phase 39: `reports/quality-gates/phase-39/run-20260425041112/phase-39-quality-gate.json`.
- Phase 41: `reports/eval/fallback/phase-41/run-20260425213045/report.json`, `reports/eval/live-memory/phase-41/run-phase41-live-current/report.json`, `reports/quality-gates/phase-41/run-20260425223045/phase-41-quality-gate.json`.
- Phase 42: `reports/quality-gates/phase-42/run-20260426100000/phase-42-quality-gate.json`.
- Phase 43: `reports/eval/fallback/phase-43/run-20260426113000/report.json`, `reports/quality-gates/phase-43/run-20260426120000/phase-43-quality-gate.json`.
- Phase 43.5: `reports/eval/fallback/phase-43-5/run-20260426133000/report.json`, `reports/quality-gates/phase-43-5/run-20260426140000/phase-43-5-quality-gate.json`.
- Phase 45: Phase 45 is now closed as the First Reference Product and Adoption Evidence slice; examples/reference-chat-product, `bun run eval:phase-45`, `bun run gate:phase-45`, `reports/eval/adoption/phase-45/run-20260427104530-adoption-eval/report.json`, `reports/quality-gates/phase-45/run-20260427110000/phase-45-quality-gate.json`, `docs/archive/quality-gates/GoodMemory-Phase-45-Quality-Gate.md`.
- Phase 46: Phase 46 is now closed as the Memory Quality and Maintenance 2.0 slice; `bun run eval:phase-46`, qualityRepair, `reports/eval/fallback/phase-46/run-20260427123000-quality-eval/report.json`, `reports/quality-gates/phase-46/run-20260428110000/phase-46-quality-gate.json`, `docs/archive/quality-gates/GoodMemory-Phase-46-Quality-Gate.md`.
- Phase 47: Phase 47 is now closed as the Provider-Backed Retrieval Rollout and Quality Promotion slice; `bun run eval:phase-47`, `reports/eval/fallback/phase-47/run-20260428120000-provider-rollout-eval/report.json`, `reports/quality-gates/phase-47/run-20260428123000/phase-47-quality-gate.json`, `docs/archive/quality-gates/GoodMemory-Phase-47-Quality-Gate.md`.
- Phase 48: Phase 48 is now closed as the Dashboard, Cloud Sync, and Team Workspace Decision slice; `bun run eval:phase-48`, no-go decision, `reports/eval/fallback/phase-48/run-20260428170000-dashboard-cloud-decision/report.json`, `reports/quality-gates/phase-48/run-20260428173000/phase-48-quality-gate.json`, `docs/archive/quality-gates/GoodMemory-Phase-48-Quality-Gate.md`.
- Phase 49: Phase 49 is now closed as the Full ImplicitMemBench GoodMemory Research Eval; baseline-upstream-chat, goodmemory-raw-experience, goodmemory-distilled-feedback, `reports/eval/research/phase-49/baseline/run-phase49-smoke-current/report.json`, `reports/eval/research/phase-49/goodmemory/run-phase49-smoke-current/report.json`, `reports/eval/research/phase-49/comparison/run-phase49-smoke-current/report.json`, `reports/quality-gates/phase-49/run-20260428210000/phase-49-quality-gate.json`, `docs/archive/quality-gates/GoodMemory-Phase-49-Quality-Gate.md`.
- Phase 50: `reports/eval/fallback/phase-50/run-20260428223000-installer-eval/report.json`, `reports/quality-gates/phase-50/run-20260428224500/phase-50-quality-gate.json`, `docs/archive/quality-gates/GoodMemory-Phase-50-Quality-Gate.md`.
- Phase 52: `reports/eval/fallback/phase-52/run-phase52-fallback-current/report.json`, `reports/eval/live-memory/phase-52/run-phase52-live-current/report.json`, `reports/quality-gates/phase-52/run-20260502183000/phase-52-quality-gate.json`, `docs/archive/quality-gates/GoodMemory-Phase-52-Quality-Gate.md`.
- Phase 59: Phase 59 is the Generalized Raw Executor Cleanup slice; failed/preferred operations, `reports/eval/fallback/phase-59/run-phase59-fallback-current/report.json`, `reports/eval/fallback/phase-59/run-phase59-fallback-current/raw-diagnostics.json`, `reports/quality-gates/phase-59/run-20260504193000/phase-59-quality-gate.json`, `docs/archive/quality-gates/GoodMemory-Phase-59-Quality-Gate.md`, `goodmemory-raw-experience` at `58 / 60`, raw `90 / 200`, raw `88 / 200`, raw at least `115 / 200`, distilled `151 / 200`.

## Documentation Policy

Root current-status docs should stay compact. If a future change needs detailed phase provenance, add it to generated reports or an archive summary, not this file.
