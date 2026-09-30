# GoodMemory Kimi Code Setup Guide

GoodMemory adds local-first, auditable cross-session project memory to Kimi
Code through a Kimi plugin and a local MCP server. Recall is on demand. The
plugin exposes the governed write tool at install time, but Kimi Code approval
still controls each unapproved MCP call.

## Requirements

The repository descriptors target the stable `0.8.0` release and run
`npx goodmemory@0.8.0`. The latest
complete [maintainer-run Kimi Code acceptance](https://github.com/hashgraph-online/awesome-ai-plugins/pull/95#issuecomment-5380739387)
is for GoodMemory `0.7.5` on Kimi Code `0.38.0` (macOS arm64). A complete
Kimi run against the public `0.8.0` download has not been recorded.

- Kimi Code with plugin support.
- Node.js 20 or newer, with `npx` on `PATH`.
- Bun 1.3.14 or newer on `PATH`.
- The complete `0.7.5` Kimi acceptance was on macOS arm64. A second clean
  support environment and Windows Kimi smoke remain unverified.

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

The version-pinned `0.8.0` plugin-only ZIP is published as a
[GitHub Release asset](https://github.com/hjqcan/GoodMemory/releases/tag/v0.8.0).
Start Kimi Code in a project and run:

```text
/plugins install https://github.com/hjqcan/GoodMemory/releases/download/v0.8.0/goodmemory-kimi-plugin-0.8.0.zip
```

Review the third-party source and confirm the trust prompt; third-party
installation defaults to cancel. Then activate the managed copy with either:

```text
/reload
```

or start a clean session with `/new`.

### Installation evidence and source alternative

The release ZIP contains only the plugin manifest, license, Skill, and four
commands; the MCP runtime remains pinned to the same npm version. The
published asset, npm tarball, release manifest, and evidence archive passed
the read-only release verifier. Before publication, a local development ZIP
passed native Kimi `0.41.0` ZIP-URL installation, trust, managed-copy, reload,
and MCP connection checks over loopback HTTP. Those checks used a nine-tool
development package, whereas the published `0.8.0` plugin exposes ten tools.
The additional online end-to-end run stopped when the configured model
service returned HTTP 401, as disclosed in the
[release notes](https://github.com/hjqcan/GoodMemory/releases/tag/v0.8.0).
Neither local check proves a complete run from
the public ZIP.

The bare GitHub source is another installation path:

```text
/plugins install https://github.com/hjqcan/GoodMemory
```

It succeeded for the `0.7.5` macOS acceptance but timed out in the `0.8`
test environment. Do not infer current bare-source installation success from
the earlier run.

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
