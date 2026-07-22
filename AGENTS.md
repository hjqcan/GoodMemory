# Repository Guidelines

> **Are you an agent here to _adopt_ GoodMemory (give yourself or your host
> durable memory), not to _contribute_ to it?** Stop reading this file — it is
> the contributor guide. Go to [llms.txt](./llms.txt) for a machine-readable
> onboarding decision tree, or the
> [README Quickstart](./README.md#quickstart-codex-or-claude-code-memory). The
> capability descriptor at [.well-known/goodmemory.json](./.well-known/goodmemory.json)
> has install commands, the MCP endpoint, and HTTP endpoints as JSON.
>
> The rest of this document is for agents and humans **working on** the
> GoodMemory codebase.

## Project Structure & Module Organization

Treat this file as a routing layer, not the final authority. Start with
`docs/README.md` for documentation routing and `task-board/00-README.txt` for
execution order. Do not bulk-read `docs/`, `task-board/`, `reports/`, or
`docs/archive/` unless a task explicitly needs historical provenance.

```text
README.md
docs/
├── README.md                                                 # documentation router and archive policy
├── GoodMemory-Current-Status-and-Evidence.md                 # current public surface and canonical evidence
├── GoodMemory-First-Principles-and-Reference-Architecture.md  # canonical design, core beliefs, operating principles
├── GoodMemory-ImplicitMemBench-Full-300-Research-Summary.md    # ImplicitMemBench Full-300 research summary (0.691 claim)
├── GoodMemory-OSS-Architecture-v1.md                          # historical v1 map of domains, packages, and boundaries
├── GoodMemory-PRD.md                                          # product scope and behavior contract
├── GoodMemory-TDD-and-Evaluation-Strategy.md                  # test pyramid, eval design, fixture strategy
├── GoodMemory-v1-Quality-Gate.md                              # historical v1 verification snapshot
├── GoodMemory-v1-Release-Checklist.md                         # historical release readiness baseline
├── GoodMemory-Unified-Self-Evolving-Roadmap.md                # historical roadmap after the v1 core
├── archive/quality-gates/README.md                            # archived phase closure summaries and gate index
├── archive/design-inputs/                                     # superseded drafts, not current truth
├── archive/reference-corpus/                                  # copied research/source material, targeted lookup only
├── GoodMemory-记忆数据分层设计.md                               # layering and storage reference
└── ...

task-board/
├── 00-README.txt                                              # canonical execution order, status markers, working rules
├── 01-phase-0-...txt -> 25-phase-24-...txt                    # phase-level execution plan
└── phase-*/00-README.txt                                      # per-phase breakdown and acceptance criteria

adr/
├── ADR-001-memory-taxonomy.txt
├── ADR-002-public-api.txt
├── ADR-003-runtime-context-controls.txt
├── ADR-004-maintenance-engine.txt
├── ADR-005-scenario-fitted-recall-boundary.txt        # dual-metric recall + scenario-rule admission
├── ADR-006-module-layering-and-shared-contracts.txt   # domain/ contract home, provider ↛ eval
└── ADR-007-python-client-and-docker-distribution.txt   # Python client + Docker distribution

src/
├── index.ts                                                   # package root exports
├── api/                                                       # createGoodMemory surface plus internal runtime/governance wiring
├── ai-sdk/                                                    # AI SDK-facing public exports and contracts
├── domain/                                                    # taxonomy, scope, provenance, core records
├── remember/                                                  # write path: extraction, classification, candidate handling
├── recall/                                                    # retrieval planning, scoring, selection, context assembly
├── answer/                                                     # answer evidence-pack composition and operation guides
├── runtime/                                                   # session-scoped context services and spillover controls
├── maintenance/                                               # decay, dream, consolidation, and maintenance runners
├── verify/                                                    # verification policy for stale or inferred memory
├── storage/                                                   # in-memory, sqlite, postgres, and repository adapters
├── eval/                                                      # eval runners, judge integration, reporting
├── evidence/ evolution/ governance/                           # evidence records, proposal flow, and governance helpers
├── embedding/ provider/                                       # vector write plumbing and provider-backed model adapters
├── host/                                                      # host-facing integration surface and exported contracts
├── language/                                                  # locale-aware extraction and normalization
├── policy/ testing/                                           # policy hooks and shared test helpers
└── cli.ts                                                     # CLI entrypoint exposed via package exports

tests/
├── unit/ integration/ scenarios/ eval/                        # canonical red/green layers
├── cli/ examples/ release/ types/                             # CLI, example, packaging, and type-surface regressions
└── ...

fixtures/
├── personas/eval/ and scenarios/eval/                         # eval personas and replay cases
├── conversations/ personas/ rubrics/ scenarios/               # supporting fixture sources
└── ...

reports/quality-gates/
├── phase-*/                                                   # accepted phase gate artifacts
└── ...

reports/eval/
├── fallback/                                                  # deterministic validation artifacts
├── live/                                                      # live model eval artifacts with in-memory memory backend
└── live-memory/                                               # provider-backed live-memory eval artifacts

scripts/ and examples/ hold developer utilities, CLI/eval runners, and reference integrations.
```

Use `docs/README.md` first when choosing which document to open. Use
`docs/GoodMemory-Current-Status-and-Evidence.md` for the current stable repo
view, `docs/GoodMemory-First-Principles-and-Reference-Architecture.md` for
product principles, `docs/GoodMemory-OSS-Architecture-v1.md` for the historical
v1 module-boundary map, `task-board/00-README.txt` for execution order, and
`docs/archive/quality-gates/README.md` plus `reports/quality-gates/` and
`reports/eval/` for verification evidence. Scored quality and gap tracking live
in the phase board and generated eval artifacts, not in `AGENTS.md`. Superseded
drafts under `docs/archive/design-inputs/` are not current truth.

## Build, Test, and Development Commands

- `bun test`: run the canonical repository suite rooted at `tests/` via `bunfig.toml`; this is the default red/green path in local work and CI, excluding explicit quality-gate replays under `tests/quality-gates/`.
- `bun run test:all`: sweep `tests/` plus vendored `third-party/` trees with the broad-root Bun config when you intentionally want the wider pass.
- `bun run test:phase-73-gates`: run the expensive Phase 73 C5 readiness materialization, projection, independent-verifier, and mutation replay suite excluded from the canonical red/green loop.
- `bun run test:watch`: rerun the canonical suite during local development.
- `bun run test:coverage`: run the canonical suite with coverage gates, then enforce script/source coverage via `scripts/check-coverage.ts`.
- `bun run typecheck`: run strict TypeScript checks with `tsc --noEmit`.
- `bun run eval:smoke`: verify eval wiring without live model calls.
- `bun run eval:fallback`: run the deterministic fixture-based eval path and write reports to `reports/eval/fallback/`.
- `bun run eval:live`: run the live generator + live judge eval path with the in-memory memory backend and write reports to `reports/eval/live/`.
- `bun run eval:live-memory`: run the live generator + live judge eval path with auto-storage memory resolution and write reports to `reports/eval/live-memory/`. This needs the live eval/judge env vars plus `GOODMEMORY_EMBEDDING_*` and `GOODMEMORY_ASSISTED_EXTRACTOR_*`. Storage follows the normal runtime resolver: default local SQLite, or provider-backed when `GOODMEMORY_STORAGE_PROVIDER` / `GOODMEMORY_STORAGE_URL` resolve to Postgres.
- `bun run eval:live-auto-memory`: explicit alias of `eval:live-memory` for scripts that want to emphasize auto-storage semantics.
- `bun run eval:live-provider-memory`: run the explicit provider-backed live eval path with Postgres storage, embeddings, and assisted extraction; write reports to `reports/eval/live-provider-memory/`. This needs the live eval/judge env vars plus `GOODMEMORY_TEST_POSTGRES_URL`, `GOODMEMORY_EMBEDDING_*`, and `GOODMEMORY_ASSISTED_EXTRACTOR_*`.
- `bun run eval:summary`: summarize existing eval output directories.
- `bun run eval:phase-24`: run the implicit behavioral adaptation deterministic eval slice and write reports under `reports/eval/fallback/phase-24/`.
- `bun run gate:phase-24`: validate the accepted Phase 24 quality gate and write the gate artifact under `reports/quality-gates/phase-24/`.
- `bun run fixtures:generate`: regenerate eval fixtures under `fixtures/`.

There is no separate build step today; contributors work directly against Bun + TypeScript sources.

## Coding Style & Naming Conventions

Use TypeScript with ESM imports, strict typing, and ASCII by default. Follow the existing style: 2-space indentation, semicolons, trailing commas, and descriptive factory names such as `createGoodMemory`, `createRecallEngine`, and `createPostgresDocumentStore`. Prefer small, focused modules and explicit named exports. There is no dedicated lint script yet, so match nearby files closely. Use `*.test.ts` for test files and keep shared helpers under `src/testing/` or suite-local helpers inside `tests/`.

## Testing Guidelines

TDD is mandatory here: add a failing test first, then implement. Put pure logic in `tests/unit/`, API and storage flows in `tests/integration/`, replay coverage in `tests/scenarios/`, product-level regressions in `tests/eval/`, explicit slow evidence replays in `tests/quality-gates/`, and CLI/package/type-surface checks in `tests/cli/`, `tests/examples/`, `tests/release/`, and `tests/types/`. Live Postgres coverage requires `GOODMEMORY_TEST_POSTGRES_URL`; otherwise those suites are skipped. Generic `eval:live-memory` runs require the live eval/judge env vars plus `GOODMEMORY_EMBEDDING_*` and `GOODMEMORY_ASSISTED_EXTRACTOR_*`, while explicit provider-backed runs such as `eval:live-provider-memory` and phase-specific `*-live-memory` runners also require `GOODMEMORY_TEST_POSTGRES_URL`. Run `bun test` and `bun run typecheck` before opening a PR; run the relevant explicit quality-gate command when changing its verifier or evidence protocol, and use `bun run test:coverage` for release-facing changes.

## Commit & Pull Request Guidelines

Recent history mixes scoped English subjects and short milestone commits, for example `Enhance AI SDK integration and examples` and `phase 23完成`. Keep new subjects specific and easy to scan. PRs should include a concise summary, linked task-board item or ADR when relevant, and the commands you ran. If a change touches Postgres, fixtures, or eval output, note the environment used and whether `reports/eval/` or `reports/quality-gates/` changes are intentional.

<!-- GOODMEMORY-INSTALL:CODEX START -->
## GoodMemory Codex

This repository opts into the installed GoodMemory Codex host-config path.

Prefer hook-injected GoodMemory context when the installed host runtime provides it.
Use GoodMemory MCP for deep memory inspection or recall debugging when the installed host runtime exposes it.
Treat exported artifact files as projections, not canonical truth.
<!-- GOODMEMORY-INSTALL:CODEX END -->
