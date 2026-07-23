# GoodMemory Standalone MCP Setup Guide

Standalone mode runs the GoodMemory MCP server without any installed host
config (`goodmemory setup` is not required). Any MCP client — Cursor, Windsurf,
Cline, Claude Desktop, Gemini CLI, OpenCode, or your own — can add it with one
config block. Scope and storage come from flags and environment variables.

Per-host recipes: [Cursor](./GoodMemory-Cursor-Setup-Guide.md) ·
[Gemini CLI](./GoodMemory-Gemini-CLI-Setup-Guide.md) ·
[OpenCode](./GoodMemory-OpenCode-Setup-Guide.md). For Codex and Claude Code,
prefer the managed installed-host path (`goodmemory setup`), which adds hooks
and writeback governance on top of MCP.

## Prerequisites

- Node.js 20+ for the npm install.
- **Bun 1.3+ on PATH.** The `goodmemory-mcp` bin is a launcher that spawns
  `bun`; without Bun it exits with an install hint.

The registry command below applies after `goodmemory@0.7.0` is published.
Before publication, install the verified local `goodmemory-0.7.0.tgz` produced
by the release workflow.

```bash
npm install -g goodmemory@0.7.0
```

## Start the server

```bash
goodmemory-mcp --standalone --user-id <your-user-id>
```

The transport is stdio: your MCP client spawns this command; you do not run it
in a terminal for normal use. A user id is required — startup fails fast
without `--user-id` or `GOODMEMORY_USER_ID`.

## Flags and environment fallbacks

Precedence: per-call tool argument > CLI flag > environment variable > default.

| Flag | Env fallback | Default |
|---|---|---|
| `--user-id <id>` | `GOODMEMORY_USER_ID` | required |
| `--workspace-id <id>` | `GOODMEMORY_WORKSPACE_ID` | derived from the per-call `cwd` basename |
| `--agent-id <id>` | `GOODMEMORY_AGENT_ID` | unset (see scope note) |
| `--session-id <id>` | — | unset; per-call `sessionId` overrides |
| `--storage-provider <memory\|sqlite\|postgres>` | `GOODMEMORY_STORAGE_PROVIDER` | `sqlite` |
| `--storage-url <path-or-url>` | `GOODMEMORY_STORAGE_URL` | `~/.goodmemory/standalone.sqlite` (sqlite); required for postgres |
| `--max-tokens <n>` | — | 256 |
| `--retrieval-profile <coding_agent\|general_chat>` | — | `coding_agent` |
| `--allow-write` | `GOODMEMORY_MCP_ALLOW_WRITE=1` | off (read-only surface) |

`GOODMEMORY_HOME` relocates the `~/.goodmemory` directory (default sqlite file,
progressive-recall secret and cache).
For sqlite `--storage-url` values, GoodMemory expands `~` itself so JSON-based
MCP clients do not need shell expansion.

## Scope note: agent visibility

GoodMemory's default scope guard is containment-based: a scope **without**
`agentId` sees only agent-less records, and memories written by an installed
host carry that host's agent tag (`claude` / `codex`) and stay private to it.

- Default standalone (`--agent-id` unset): reads and writes agent-less memory.
- To read an installed host's memory, opt in explicitly — point at the same
  database and name the agent:

```bash
goodmemory-mcp --standalone --user-id <id> \
  --storage-url ~/.goodmemory/memory.sqlite \
  --agent-id codex
```

Note that a defined `--agent-id` is a hard filter: the server then sees ONLY
that agent's records.

## Read-only tools (default surface)

`goodmemory_get_context`, `goodmemory_inspect_memory`, `goodmemory_trace_recall`,
`goodmemory_search_index`, `goodmemory_timeline`, `goodmemory_get_records`,
`goodmemory_read_artifacts`, `goodmemory_stats` — identical to the installed
MCP surface.

## Opt-in write tool

`--allow-write` (or `GOODMEMORY_MCP_ALLOW_WRITE=1`) registers a ninth tool,
`goodmemory_remember`, which lets the connected model persist a memory-worthy
statement as durable memory.

- The write is **governed**: it goes through the normal remember pipeline —
  classification thresholds, dedupe/supersession, policy hooks, and evidence
  records. Low-signal content is rejected (see `accepted` / `rejected` in the
  result).
- If the tool call omits `role`, the content is treated as
  assistant-originated. Pass `role: "user"` only when the statement came from
  the user.
- Assistant-originated writes (`role: "assistant"`) face the stricter
  assistant-output policies.
- Security posture: enabling writes means the model can persist durable state.
  Keep it off for inspection-only setups; on installed hosts, enable it via the
  environment variable (see below), not by editing managed args.

Installed-host note: `goodmemory mcp serve --host <codex|claude>` also accepts
the write opt-in, but managed MCP config blocks are auto-repaired back to
exactly `--host <host>` — set `GOODMEMORY_MCP_ALLOW_WRITE=1` in the managed
block's `env` instead of adding the flag.

## Verify

Ask the connected agent to call `goodmemory_stats`: a counts object confirms
the server, storage, and scope are wired. Then `goodmemory_get_context` with a
question about something you stored.

## Troubleshooting

- "Standalone mode requires a user id" — pass `--user-id` or set
  `GOODMEMORY_USER_ID` in the client config's `env` block.
- "requires Bun" from the launcher — install Bun (https://bun.sh) or set
  `GOODMEMORY_BUN_BINARY` to its path.
- Empty recalls against a shared installed-host database — you are probably
  missing `--agent-id` (see the scope note above).
- `--storage-provider memory` gives each tool call a fresh empty store; use the
  sqlite default for anything beyond smoke tests.
