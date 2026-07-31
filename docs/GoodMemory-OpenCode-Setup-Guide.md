# GoodMemory OpenCode Setup Guide

Give OpenCode durable project/user memory through the standalone GoodMemory
MCP server. One `mcp` block; no installed-host setup required.

Prerequisites and the full flag/env matrix live in the canonical
[Standalone MCP Setup Guide](./GoodMemory-Standalone-MCP-Setup-Guide.md)
(short version: `npm install -g goodmemory`, and Bun 1.3.14+ on PATH — the
`goodmemory-mcp` bin launches Bun).

## Configure

Project-scoped: `opencode.json` in the repo root. Global:
`~/.config/opencode/opencode.json`. Note OpenCode's shape differs from other
hosts: `command` is an array and env vars go under `environment`.

```json
{
  "mcp": {
    "goodmemory": {
      "type": "local",
      "command": ["goodmemory-mcp", "--standalone", "--user-id", "YOUR_USER_ID"],
      "enabled": true,
      "environment": {
        "GOODMEMORY_MCP_ALLOW_WRITE": "0"
      }
    }
  }
}
```

Set `GOODMEMORY_MCP_ALLOW_WRITE` to `1` (or append `--allow-write` to the
command array) to register the opt-in `goodmemory_remember` write tool; leave
it off for a read-only surface.

To share an installed Codex/Claude Code host's database, append
`"--storage-url", "~/.goodmemory/memory.sqlite", "--agent-id", "codex"` to the
command array (agent-tagged memories are private to their agent unless named).
GoodMemory expands `~` for sqlite storage URLs inside JSON args; OpenCode does
not need shell expansion.

## Verify

Ask the agent to call `goodmemory_stats`: a counts object confirms the server,
storage, and scope are wired. Expect 8 tools (9 with writes enabled).
