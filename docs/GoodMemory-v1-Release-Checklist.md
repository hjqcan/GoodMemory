# GoodMemory v1 Release Checklist

> **Historical baseline.** This checklist was authored for the v0.2 → v1 release,
> so its gate/eval sections point at the accepted **Phase 40** release-candidate
> gate. The current tree is preparing the **0.7.2** stable artifact; npm
> `latest` remains `goodmemory@0.7.1` until publication. The
> release workflow must publish and verify the exact npm artifact before it
> creates the `v0.7.2` GitHub Release. Current releases follow the documented 0.7.x
> version-bump recipe plus
> `gate:public-benchmark-claim` and the
> release-readiness gate rather than the Phase 40 gate. Treat the Phase 40
> references below as the historical release baseline, and note that later
> capabilities (host-memory experience, standalone MCP, agent onboarding, the
> `goodmemory/runtime-kit` subpath) shipped after the original checklist slice
> and are noted where the current 0.7.2 package boundary requires them.

## Package Boundary

- `0.7.2` packages `goodmemory`, `goodmemory/ai-sdk`, `goodmemory/host`, `goodmemory/http`, and `goodmemory/runtime-kit` through compiled `dist/` outputs plus declarations
- registry publish is handled by the tagged stable release workflow when `NPM_TOKEN` is configured
- `bun pm pack` tarball remains a canonical installable release artifact
- public package surface includes:
  - `goodmemory`
  - `goodmemory/ai-sdk`
  - `goodmemory/host`
  - `goodmemory/http`
  - `goodmemory/runtime-kit`
- package-boundary CI covers Node 20, Node 22, and Node 24
- the installed CLI and `goodmemory-http-bridge` server remain Bun-backed runtime add-ons
- the original Phase 40 slice added no dashboard/admin UI or public `goodmemory/evolution` module; the later Phase 71 Inspector is part of the current package

## CLI

- `goodmemory inspect` reads scope-bounded memory from the supported storage backend
- `goodmemory trace` shows routing, hits, candidate traces, verification hints, and applied policy markers without mutating memory state
- `goodmemory export-memory` writes JSON export plus Markdown artifacts cleanly
- `goodmemory stats` reports scope-bounded counts and backend metadata
- `goodmemory eval inspect` works against eval run directories
- `goodmemory eval trace` shows write trace, recall hits, verification hints, and applied policy markers
- `goodmemory eval export-case` copies case artifacts cleanly

## Governance

- `exportMemory()` exports scope-bounded durable memory
- `deleteAllMemory()` deletes scope-bounded durable memory and clears runtime state when requested
- `ignoreMemory` produces an explainable empty recall result
- policy hooks cover:
  - `shouldRemember`
  - `shouldRecall`
  - `redact`
  - `resolveConflict`
- public remember customization covers:
  - `GoodMemoryConfig.remember`
  - `RememberProfile`
  - `rememberRules`
  - `RememberInput.annotations`
  - traceable domain metadata on export
- `raw-recall.json` includes `policyApplied`

## Examples

- `bun run example:chat` works
- `bun run example:coding-agent` works
- `bun run example:express-chat` works
- `bun run example:fastify-chat` works
- README links both examples and explains when to use each

## Eval

- `bun run eval:smoke` passes
- `bun run eval:fallback` produces a deterministic validation report
- `bun run eval:live` produces a live report
- `bun run eval:live-memory` produces an auto-storage live memory report
- `bun run eval:live-provider-memory` produces a provider-backed live memory report
- `bun run eval:phase-40-cross-consumer` produces the accepted cross-consumer
  adoption smoke report at
  `reports/eval/adoption/phase-40/run-20260425163012-cross-consumer/report.json`
- `bun run eval:phase-40-product` produces the accepted no-memory versus
  with-GoodMemory product eval rollup at
  `reports/eval/product/phase-40/run-20260425165544-product-eval/report.json`
- `raw-recall.json` exists for GoodMemory cases
- report shows top-level `mode`
- report shows `runtime.generationMode` and `runtime.judgeMode`

## Strategy Rollout

- non-default promotion is blocked unless `strategy-promotion-gate.json` reports `accepted/passed`
- non-default promotion requires an explicit `strategy-promotion-authorization.json`
- `regression-dashboard.json` exists and shows no blocking cases for any promoted path
- `public-surface-decision.json` exists and matches the documented OSS surface
- observe / assist / promote guidance is documented in `docs/GoodMemory-Strategy-Rollout-Guide.md`
- `docs/GoodMemory-Current-Status-and-Evidence.md` summarizes the current canonical evidence entrypoints
- `docs/archive/quality-gates/README.md` indexes the archived phase-specific closure docs
- rollback conditions explicitly keep `rules-only` available as the supported fallback
- root runtime entrypoints keep salvage hooks and promotion-gate runtime controls internal

## Quality Gate

- `bun test` passes on the canonical `tests/` suite
- `bun run test:coverage` passes and enforces script/source coverage gates
- `bun run gate:phase-35` passes
- `bun run gate:phase-36` passes
- `bun run gate:phase-37` passes
- `bun run gate:phase-38` passes
- `bun run gate:phase-39` passes
- `bun run gate:phase-40` passes
- the accepted Phase 40 v0.2 release-candidate gate report lives at
  `reports/quality-gates/phase-40/run-20260425172323/phase-40-quality-gate.json`
- typecheck passes
- governance tests pass
- no unresolved critical regressions in recent eval output
- the tagged release workflow runs the Phase 40 v0.2 release-candidate gate

## Packaging

- `package.json` exposes `bin`, `exports`, and example scripts
- `package.json` is not private and uses version `0.7.2`
- `package.json` declares Node and Bun runtime support for the packaged boundary
- `LICENSE` exists and matches package metadata
- CLI wrapper exists at `scripts/goodmemory-cli.js`
- `bun pm pack --dry-run` succeeds
- the tarball contains compiled `dist/` exports, the CLI entrypoint, docs, and license
- the tarball omits repo-only payload such as tests, task-board files, and reports
- a fresh Node or Bun consumer can install the tarball and use only:
  - `goodmemory`
  - `goodmemory/ai-sdk`
  - `goodmemory/host`
- the global CLI works through `goodmemory ...` after `npm install -g goodmemory`
- a project-local package install documents `npx goodmemory` or
  `./node_modules/.bin/goodmemory`, not a shell-global bare command
- README links canonical docs, current status, eval strategy, archive index, and release checklist

## Manual Review

- public API surface matches current product story
- Node-compatible library wording is explicit, and Bun-backed CLI/runtime-specific local storage wording is also explicit
- governance controls match PRD and v1 architecture requirements
- installed-package docs show Node-compatible install plus Bun-specific runtime notes before any repo-local development notes
- examples still reflect the recommended integration path
- latest live eval report is archived under `reports/eval/live/`
- latest provider-backed live eval report is archived under `reports/eval/live-provider-memory/` or the dedicated phase live-memory evidence directory
- latest fallback validation report is archived under `reports/eval/fallback/`
- the active stable release gate report lives under `reports/quality-gates/phase-40/`
- the accepted Phase 40 archive summary is `docs/archive/quality-gates/GoodMemory-Phase-40-Quality-Gate.md`
- the Phase 39 Python HTTP bridge gate remains archived under `reports/quality-gates/phase-39/`
- the historical Phase 29 gate and RC dry-run reports remain archived under `reports/quality-gates/phase-29/`
