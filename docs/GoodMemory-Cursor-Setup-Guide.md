# GoodMemory Cursor Setup Guide

Give Cursor durable project/user memory through the standalone GoodMemory MCP
server. One config block; no installed-host setup required.

Prerequisites and the full flag/env matrix live in the canonical
[Standalone MCP Setup Guide](./GoodMemory-Standalone-MCP-Setup-Guide.md)
(short version: `npm install -g goodmemory`, and Bun 1.3.14+ on PATH — the
`goodmemory-mcp` bin launches Bun).

## Configure

Project-scoped: create `.cursor/mcp.json` in the repo root. Global: use
`~/.cursor/mcp.json` instead.

```json
{
  "mcpServers": {
    "goodmemory": {
      "command": "goodmemory-mcp",
      "args": ["--standalone", "--user-id", "YOUR_USER_ID"]
    }
  }
}
```

Optional write tool (lets the agent persist durable memories through the
governed remember pipeline):

```json
{
  "mcpServers": {
    "goodmemory": {
      "command": "goodmemory-mcp",
      "args": ["--standalone", "--user-id", "YOUR_USER_ID", "--allow-write"]
    }
  }
}
```

To share the memory database an installed Codex/Claude Code host already
maintains, add
`"--storage-url", "~/.goodmemory/memory.sqlite", "--agent-id", "codex"`
(agent-tagged memories are private to their agent unless named — see the scope
note in the standalone guide). GoodMemory expands `~` for sqlite storage URLs
inside JSON args; the MCP client does not need shell expansion.

## Verify

Open Cursor Settings → MCP: the `goodmemory` server should list 8 tools
(9 with `--allow-write`). Then ask the agent to call `goodmemory_stats`; a
counts object confirms storage and scope are wired.
