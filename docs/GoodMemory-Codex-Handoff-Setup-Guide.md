# GoodMemory Codex Handoff Setup Guide

This is the canonical global CLI `0.7.0` Codex installed-host setup path.

## Install

Install the CLI globally when you want to run `goodmemory` directly:

```bash
npm install -g goodmemory@0.7.0
goodmemory -V
```

Local package installs do not put `goodmemory` on your shell `PATH`. Use local
installs only when you are building an application or an advanced package-local
host adapter; then invoke the bin as `npx goodmemory`,
`npm exec -- goodmemory`, or `./node_modules/.bin/goodmemory`.

Tarball verification of the same release artifact before publish:

```bash
npm install -g ./goodmemory-0.7.0.tgz
goodmemory -V
```

## Managed Codex Setup

Run setup from the workspace that should expose GoodMemory to Codex:

```bash
goodmemory setup --host codex
goodmemory status codex --workspace-root .
```

This installs managed host wiring, enables workspace-scoped recall injection,
and keeps writeback opt-in. Use `observe` before durable `selective` writes:

```bash
goodmemory enable codex --workspace-root . --writeback observe
goodmemory codex writeback inspect --json
```

## Package-Local Bootstrap

Use this only when you need repo-local scaffold files from a package dependency
instead of the managed global installed-host path.

```bash
npm install goodmemory@0.7.0
npx goodmemory codex bootstrap --user-id <user-id> --workspace-id <workspace-id>
```

Bun services can install the same package with `bun add goodmemory@0.7.0`.

This creates repo-local scaffolding only:

- `AGENTS.md`
- `.goodmemory/bootstrap/codex-export.mjs`
- `.goodmemory/bootstrap/codex-action.mjs`
- `.codex/hooks.json`
- `.codex/config.toml`
- `codex/rules/goodmemory.rules`

The bootstrap step does not create canonical memory state or depend on a repo checkout of GoodMemory itself.

## Refresh Exported Artifacts

After your app or integration writes canonical GoodMemory state through the public package surface, refresh the Codex-facing compiled artifacts:

```bash
bun ./.goodmemory/bootstrap/codex-export.mjs --session-id <session-id>
```

Pass the real active session id. `session-memory/current.md` is only emitted when that session has runtime continuity to export.

For risky Bash commands, route execution through the installed action-gate wrapper instead of calling the raw command directly:

```bash
bun ./.goodmemory/bootstrap/codex-action.mjs --session-id <session-id> --command "<command>"
```

Treat `.goodmemory/bootstrap/codex-action.mjs` as the canonical enforced path. `.codex/hooks.json` and `codex/rules/goodmemory.rules` are generated as parity scaffolds when the current Codex runtime supports them.

Codex should read the compiled files under:

- `./.goodmemory/hosts/codex/session-memory/current.md`
- `./.goodmemory/hosts/codex/MEMORY.md`
- `./.goodmemory/hosts/codex/playbooks/*.md`

Treat those files as compiled guidance, not canonical truth.

## Public Wiring Contract

The generated bootstrap script uses public package imports only:

```ts
import { createGoodMemory } from "goodmemory";
import { createHostAdapter } from "goodmemory/host";
```

## Stable Contract

- `goodmemory` and `goodmemory/host` now resolve through compiled package artifacts on both Node and Bun.
- Non-version CLI commands remain Bun-backed today.
- Codex remains the only live gate-blocking host path for Phase 34.
- The generated bootstrap path keeps the recommended `file-assisted` read flow.
- The action-gate wrapper is the canonical live enforcement path for risky first-step rewrite and veto outcomes.
- The host path should use only:
  - `goodmemory`
  - `goodmemory/host`

## What This Guide Proves

- the installed package can scaffold Codex wiring without repo-internal imports
- generated Codex-facing artifact refresh stays on the public package surface
- the generated action-gate wrapper can enforce pre-action rewrite and veto decisions through public imports only
- Codex-style handoff can read compiled session continuity without redefining canonical truth
- the bootstrap path is repo-local, idempotent, and does not implicitly create canonical memory state
