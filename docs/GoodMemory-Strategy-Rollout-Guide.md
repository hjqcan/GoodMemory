# GoodMemory Strategy Rollout Guide

GoodMemory v1 closes Phase 17 as a retrieval-first rollout surface. `rules-only` remains the supported baseline. New retrieval behavior should move through `observe`, `assist`, and `promote` in order, and every step should be justified by persisted eval artifacts.

## Modes

- `observe`: run the candidate in isolated shadow only. Use this when you want evidence without changing the executed path. Check `shadow-executed-path-comparisons.json` and make sure observe cases stay contamination-safe.
- `assist`: let the candidate strategy execute in eval or controlled provider-backed runs. Use this to measure real uplift and real regressions before any default change.
- `promote`: only use this after `strategy-promotion-gate.json` reports `accepted/passed`, `regression-dashboard.json` shows no blocking cases for the promoted path, and an explicit internal `strategy-promotion-authorization.json` has been issued from a clean gate run.

## Rollback Triggers

Rollback to `rules-only` when any of the following is true:

- `strategy-promotion-gate.json` is `rejected` or `delayed`
- `strategy-promotion-authorization.json` is missing, expired, mismatched, or no longer trusted
- `regression-dashboard.json` reports blocking cases or new execution failures
- shadow artifacts stop proving contamination-safe behavior
- provider-backed dependencies required by the candidate strategy are unavailable

## When To Stay Rules-Only

Stay `rules-only` by default when:

- you do not have embeddings or other provider-backed recall support
- your latest eval run is incomplete or has execution failures
- you are in a regulated, low-trust, or incident-recovery environment
- the public surface decision still classifies rollout controls as internal

## Required Artifacts

Before any non-default promotion, review:

- `report.json`
- `shadow-executed-path-comparisons.json`
- `strategy-promotion-gate.json`
- `strategy-promotion-authorization.json`
- `regression-dashboard.json`
- `public-surface-decision.json`

## Dedicated Gates

- `bun run scripts/run-phase-17-eval.ts`: deterministic fallback gate for retrieval observe-mode artifacts and shadow safety
- `bun run scripts/run-phase-17-live-memory.ts`: provider-backed gate that runs both `observe` and `assist`, then writes the trusted promotion authorization artifact only when observe is clean/known-safe and the assist run is clean
