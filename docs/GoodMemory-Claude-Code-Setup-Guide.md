# GoodMemory Claude Code Setup Guide

This is the canonical global CLI `0.7.0` Claude Code installed-host setup path.

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

## Managed Claude Code Setup

Run setup from the workspace that should expose GoodMemory to Claude Code:

```bash
goodmemory setup --host claude --default-locale en-US
goodmemory status claude --workspace-root .
```

Set `--default-locale` to the BCP-47 locale that Claude Code should use when a
prompt does not contain a distinctive language signal, for example `ko-KR`,
`fr-FR`, or `es-ES`.

This installs managed host wiring, enables workspace-scoped recall injection,
and keeps writeback opt-in. Use `observe` before durable `selective` writes:

```bash
goodmemory enable claude --workspace-root . --writeback observe
goodmemory claude writeback inspect --json
```

`enable` reuses the global default locale selected by `setup`; it does not
override language configuration. Rerun setup with `--default-locale <locale>`
when that default must change.

## Package-Local Bootstrap

Use this only when you need repo-local scaffold files from a package dependency
instead of the managed global installed-host path.

```bash
npm install goodmemory@0.7.0
npx goodmemory claude bootstrap --user-id <user-id> --workspace-id <workspace-id>
```

Bun services can install the same package with `bun add goodmemory@0.7.0`.

This creates repo-local scaffolding only:

- `CLAUDE.md`
- `.goodmemory/bootstrap/claude-export.mjs`

The bootstrap step does not create canonical memory state or depend on a repo checkout of GoodMemory itself.

## Refresh Exported Artifacts

After your app or integration writes canonical GoodMemory state through the public package surface, refresh the Claude-facing compiled artifacts:

```bash
bun ./.goodmemory/bootstrap/claude-export.mjs
```

Claude should read the compiled files under:

- `./.goodmemory/hosts/claude/MEMORY.md`
- `./.goodmemory/hosts/claude/user.md`
- `./.goodmemory/hosts/claude/playbooks/*.md`

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
- Claude Code bootstrap is supported for external usability and package-boundary parity.
- Codex remains the only live gate-blocking host path for Phase 32.
- The host bootstrap path should use only:
  - `goodmemory`
  - `goodmemory/host`

## What This Guide Proves

- the installed package can scaffold Claude Code wiring without repo-internal imports
- generated Claude-facing artifact refresh stays on the public package surface
- the bootstrap path is repo-local, idempotent, and does not implicitly create canonical memory state
