# GoodMemory Kimi Code Setup Guide

GoodMemory adds local-first, auditable cross-session project memory to Kimi
Code through a Kimi plugin and a local MCP server. Recall is on demand. The
plugin exposes the governed write tool at install time, but Kimi Code approval
still controls each unapproved MCP call.

## Requirements

The repository descriptors target the stable `0.8.3` release and run
`npx goodmemory@0.8.3`. The documented published-tag acceptance is
GoodMemory `0.7.5` on Kimi Code `0.38.0` (macOS arm64), using a deterministic
loopback provider. See the evidence boundaries below before treating a
published asset as a completed Kimi end-to-end run.

- Kimi Code with plugin support.
- Node.js 20 or newer, with `npx` on `PATH`.
- Bun 1.3.14 or newer on `PATH`.
- The complete published-tag Kimi acceptance was on macOS arm64. A second
  clean support environment and Windows Kimi smoke remain unverified.

Check the additional runtime before installing:

```bash
node --version
npx --version
bun --version
```

Kimi Code itself can be installed as a standalone binary without Node.js.
GoodMemory's current MCP launcher is Bun-backed, so the plugin still needs both
Node.js and Bun.

## Install

The version-pinned `0.8.3` plugin-only ZIP is published as a
[GitHub Release asset](https://github.com/hjqcan/GoodMemory/releases/tag/v0.8.3).
Start Kimi Code in a project and run:

```text
/plugins install https://github.com/hjqcan/GoodMemory/releases/download/v0.8.3/goodmemory-kimi-plugin-0.8.3.zip
```

Review the third-party source and confirm the trust prompt; third-party
installation defaults to cancel. Then activate the managed copy with either:

```text
/reload
```

or start a clean session with `/new`.

### Installation evidence and source alternative

The release ZIP is a separate, manifest-hashed asset containing only the
plugin manifest, license, Skill, and four commands. The MCP runtime remains
pinned to the same npm version.

The [maintainer-run v0.7.5 acceptance](https://github.com/hashgraph-online/awesome-ai-plugins/pull/95#issuecomment-5380739387)
verified explicit write approval, `/new` recall, a trace for the same memory ID, and
isolation between differently named project directories. Its deterministic
loopback provider exercised Kimi's provider protocol, approval UI, MCP
transport, persistence, and workspace scoping; it does not prove model
reasoning quality, independent-user adoption, or Marketplace readiness.

During [0.8 preparation](./plans/GoodMemory-v0.8-Unpublished-Development-Plan.md#kimi-readiness-follow-up-2026-09-07-utc),
a local ZIP passed native Kimi `0.41.0` installation, trust, byte-preserving
managed-copy, reload, and MCP connection checks over loopback HTTP. Those
checks used a nine-tool development package; the published `0.8.3` plugin
exposes ten tools. The additional online end-to-end run disclosed in the
[v0.8.0 release notes](https://github.com/hjqcan/GoodMemory/releases/tag/v0.8.0)
stopped at model-service HTTP 401. Bare GitHub source installation also timed
out during preparation. These are historical test-environment outcomes, not
evidence of a current runtime failure. A complete end-to-end run from the
public `0.8.3` ZIP remains unverified.

The bare GitHub source remains an alternative installation path:

```text
/plugins install https://github.com/hjqcan/GoodMemory
```

The plugin allows up to 300 seconds for MCP startup (including `npx`
dependency installation). This is a timeout budget, not a promise about
network speed. It does not change Kimi's per-tool approval policy.

Kimi Code installs plugins at user-level, so the plugin is available in all
projects for that OS user. Pass the current project absolute path to every
tool call. The published 0.7.5 runtime nevertheless derives only its basename:
two different paths named `project-a` collide. Do not treat them as isolated
without distinct explicit workspace IDs. The 0.8 runtime fixes
the default with an absolute-path fingerprint; it does not migrate old scopes
or rewrite existing IDs. See the
[workspace migration boundary](./GoodMemory-0.7-to-0.8-Migration-Guide.md#default-workspace-identity).

## Verify

Run:

```text
/plugins info goodmemory
/mcp
/goodmemory:status
```

The `goodmemory` MCP server should be connected and expose eight read-only
tools plus `goodmemory_remember` and `goodmemory_write_note` (ten total).
A missing Bun error should tell you to install
Bun or set `GOODMEMORY_BUN_BINARY`; it is not evidence that the memory store is
empty.

## Use

```text
/goodmemory:remember Use PostgreSQL for production storage.
/goodmemory:recall What storage decision did we make?
/goodmemory:trace What storage decision did we make?
```

`/goodmemory:remember` sends one user-originated statement to the write tool.
The tool is registered automatically by the plugin, but no permanent allow rule
is installed. Kimi Code requests approval when its permission rules do not
already cover the call. Do not use a broad `mcp__*` allow rule merely to remove
that approval boundary.

The session-start Skill does not execute code and does not silently read or
write memory. It teaches Kimi when an on-demand recall is useful and when a
durable write is appropriate.

## Correct or Delete Memory

The initial Kimi plugin intentionally does not invent a `/goodmemory:forget`
command because the standalone MCP surface has no forget tool. Use the
GoodMemory Inspector or CLI administration flows described in
`GoodMemory-Inspector-and-Admin-API.md` to inspect, revise, export, or delete
incorrect memory.

## Upgrade or Remove

Install the ZIP for the version you intend to use, then run `/reload` or
`/new`. Inspect the selected version with
`/plugins info goodmemory`.

Remove the plugin with:

```text
/plugins remove goodmemory
```

Kimi Code asks for confirmation. Removing the plugin does not automatically
delete GoodMemory's local SQLite data; use the Inspector or CLI when data
deletion is intended.
