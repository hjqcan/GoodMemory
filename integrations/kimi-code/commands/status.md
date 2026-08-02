---
description: Check GoodMemory scope, record counts, and retrieval readiness.
---

Call `mcp__goodmemory__goodmemory_stats` with `cwd` set to the current project
absolute path. Summarize the returned scope, durable record counts, and
retrieval status. If the server is unavailable, report the exact diagnostic and
point to `/plugins info goodmemory` and `/mcp`; do not claim the store is empty.
