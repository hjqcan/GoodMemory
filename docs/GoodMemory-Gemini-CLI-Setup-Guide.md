# GoodMemory Gemini CLI Setup Guide

Give Gemini CLI durable project/user memory through the standalone GoodMemory
MCP server. One `mcpServers` block; no installed-host setup required.

Prerequisites and the full flag/env matrix live in the canonical
[Standalone MCP Setup Guide](./GoodMemory-Standalone-MCP-Setup-Guide.md)
(short version: `npm install -g goodmemory`, and Bun 1.3.14+ on PATH — the
`goodmemory-mcp` bin launches Bun).

## Configure

Global: `~/.gemini/settings.json`. Project-scoped: `.gemini/settings.json` in
the repo root.

```json
{
  "mcpServers": {
    "goodmemory": {
      "command": "goodmemory-mcp",
      "args": ["--standalone", "--user-id", "YOUR_USER_ID"],
      "env": {
        "GOODMEMORY_MCP_ALLOW_WRITE": "0"
      }
    }
  }
}
```

Set `GOODMEMORY_MCP_ALLOW_WRITE` to `1` (or add `--allow-write` to `args`) to
register the opt-in `goodmemory_remember` write tool; leave it off for a
read-only surface.

To share an installed Codex/Claude Code host's database, add
`"--storage-url", "~/.goodmemory/memory.sqlite", "--agent-id", "codex"` to
`args` (agent-tagged memories are private to their agent unless named).
GoodMemory expands `~` for sqlite storage URLs inside JSON args; Gemini CLI does
not need shell expansion.

## Verify

Run `gemini mcp list` (or `/mcp` inside a session): `goodmemory` should show 8
tools (9 with writes enabled). Ask the agent to call `goodmemory_stats`; a
counts object confirms storage and scope are wired.
