# GoodMemory Documentation Map

This directory is intentionally a routed documentation surface, not a corpus to
bulk-load. Start here, then open only the file that matches the question.

## Current Truth

- `GoodMemory-Current-Status-and-Evidence.md` - current shipped surface,
  accepted evidence, active phase, and claim boundaries.
- `GoodMemory-PRD.md` - product scope and behavioral contract.
- `GoodMemory-First-Principles-and-Reference-Architecture.md` - stable design
  principles and reference architecture.
- `GoodMemory-Recall-Selection-Architecture.md` - recall selection
  orchestration, selector module boundaries, and regression guardrails.
- `GoodMemory-TDD-and-Evaluation-Strategy.md` - test and eval strategy.
- `GoodMemory-Eval-Storage-Retention.md` - ephemeral eval Postgres isolation,
  successful-run cleanup, failed-run retention, and operator commands.

## Architecture And Release Baselines

- `../adr/ADR-009-orchestration-and-proof-protocol-boundaries.txt` - accepted
  runtime orchestration, repo-only proof kernel, historical verifier capsule,
  and single-manifest release boundary.
- `../scripts/release.ts` - current fail-closed `prepare` release
  entrypoint. `release-manifest.json` is authoritative; `summary.md` is a
  projection. Release candidates may prepare/upload evidence; tag publication
  is a stable-only workflow side effect.
- `../adr/ADR-008-language-pack-horizontal-extension.txt` - accepted 0.7
  LanguagePack boundary, breaking-replacement decision, script-local Chinese
  guarantee, and versioned projection migration contract.
- `GoodMemory-OSS-Architecture-v1.md` - historical v1 package/module map; use
  `GoodMemory-Current-Status-and-Evidence.md` for the current shipped surface.
- `GoodMemory-v1-Release-Checklist.md` - historical v0.2->v1 release baseline;
  use current status, task-board gates, and release scripts for current release
  execution.

## Public Integration Docs

- `GoodMemory-15-Minute-App-Integration.md` - shortest app integration path.
- `GoodMemory-LanguagePack-Extension-Guide.md` - built-in locale behavior,
  custom language-pack contract, analyzer versioning, and projection migration.
- `GoodMemory-0.6-to-0.7-Migration-Guide.md` - breaking API/configuration,
  projection cutover, validation, and rollback procedure for the 0.7 upgrade.
- `GoodMemory-Reference-Integration-Guide.md` - reference consumer pattern.
- `GoodMemory-Inspector-and-Admin-API.md` - local React Inspector, `/admin/v1`
  contract, security boundary, and operator workflows.
- `GoodMemory-Product-Comparison.md` - product positioning versus Mem0, Zep,
  LangGraph memory, vector databases, and RAG stacks.
- `GoodMemory-Codex-Handoff-Setup-Guide.md` - Codex installed-host setup.
- `GoodMemory-Claude-Code-Setup-Guide.md` - Claude Code installed-host setup.
- `GoodMemory-Standalone-MCP-Setup-Guide.md` - standalone MCP server for any
  MCP client (no installed host); canonical flag/env matrix and scope notes.
- `GoodMemory-MCP-Registry-Publishing.md` - maintainer steps for publishing the
  standalone MCP server manifest to the MCP registry.
- `GoodMemory-Cursor-Setup-Guide.md` - Cursor recipe on the standalone server.
- `GoodMemory-Gemini-CLI-Setup-Guide.md` - Gemini CLI recipe on the standalone
  server.
- `GoodMemory-OpenCode-Setup-Guide.md` - OpenCode recipe on the standalone
  server.
- `GoodMemory-Kimi-Code-Setup-Guide.md` - Kimi Code plugin install, MCP
  permission boundary, scoped recall/write commands, and lifecycle operations.
- `GoodMemory-Python-HTTP-Integration-Bridge.md` - Python/FastAPI bridge.
- `cookbooks/langgraph.md` - LangGraph store adapter (TypeScript).
- `cookbooks/openai-agents-sdk.md` - OpenAI Agents SDK via the Python client.
- `cookbooks/crewai.md` - CrewAI via the Python client.
- `GoodMemory-Strategy-Rollout-Guide.md` - observe/assist/promote rollout.

## Research And Evidence

- `plans/GoodMemory-v0.7.3-Replacement-Protection-Protocol.md` - passing
  lifecycle schema-9 evidence, two retained terminal full-claim attempts, and
  the completed commit-bound protocol-v2 successor for candidate `996c181e`.
  Its first retrieval-only seed pass completed 1,540/1,540 questions, so no
  resume was used; re-answering and independent judging also completed with
  zero failures. The tracked projection reports official `0.8805`, strict
  `0.6266`, and open-domain `58/96`. The document also records the
  governance-only preregistration and attestation that keep the current claim
  presentation separate from the historical v0.6 row without changing the
  measured runtime or evidence.
- `GoodMemory-Preference-Identity-Pre-API-Research.md` - frozen pre-API
  preference atomization/key-stability protocol, completed no-API decision,
  fixture-only conflict census, and synthetic policy comparison; not a
  production-incidence claim.
- `plans/GoodMemory-v0.8-Unpublished-Development-Plan.md` - single-main
  sequencing and the evidence-limited v0.8 scope; development starts only
  after v0.7.3 publication and v0.8 is not release-authorized.
- `GoodMemory-ImplicitMemBench-Full-300-Research-Summary.md` - internal
  ImplicitMemBench research summary. Do not treat it as a release gate.
- `Sequential Benchmark Hardening Plan.md` - external benchmark sequence.
- `plans/GoodMemory-Codex-Coding-Effect-Evaluation-and-Development-Plan.md` -
  Codex-first host-native coding A/B design, hidden-test evidence contract, TDD
  implementation order, and public-claim gate; Claude Code is deferred. Its
  active source-v4 path is selected through `scripts/research/protocols.json`
  and `scripts/research.ts`; exact registered gates replace the former
  phase-wide glob. Historical C3/C4/C5 and source-v1/v2/v3 scripts remain
  direct, source-bound replays rather than package aliases.
- `../scripts/research/protocols.json` - static active-protocol registry with
  source identity, entrypoints, canonical artifacts, exact historical gates,
  and external prerequisites. Historical execution occurs in an isolated
  checkout at that identity. Use `research:list`, `research:run`, or
  `research:verify`; this registry is not a workflow engine.
- `plans/GoodMemory-Phase-74-Generalized-Memory-Core-Implementation.md` -
  experimental generalized-memory implementation record, completed local
  verification, scale evidence, and the still-unmet cross-benchmark promotion
  boundary.
- `beam-instruction-following-diagnosis.md` - why BEAM instruction_following
  0.394 is a design tension (abstention vs world-knowledge), not a shaping bug.
- `archive/quality-gates/README.md` - historical quality-gate index.
- `reports/eval/` and `reports/quality-gates/` - generated evidence artifacts.

## Archive Policy

- `archive/design-inputs/` contains superseded drafts, competitor notes,
  cloud/member sketches, and app-specific planning inputs. These are not
  current truth.
- `archive/reference-corpus/` contains copied research/source material. These
  files are not routed by default and should be opened only for targeted
  provenance checks.

Do not add a new root-level planning document when an existing current-truth
document can be updated. If a document is replaced, move it under
`archive/design-inputs/` or delete it in the same change that updates links and
tests. Root-level docs should stay small enough for agent use.
