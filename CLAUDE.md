<!-- GOODMEMORY-INSTALL:CLAUDE START -->
## GoodMemory Claude Code

This repository uses GoodMemory (installed Claude Code host path) for durable, governed memory.

Memory protocol:
- Hook-injected "Developer memory notes" blocks are memory retrieved for the current prompt. Read them before planning and prefer them over re-deriving project facts; verify time-sensitive facts against the repo before acting on them.
- When injected context is missing or insufficient, call goodmemory_get_context with a specific question (any question, not just the current prompt).
- When you need specific records rather than a rendered summary, call goodmemory_search_index and then goodmemory_get_records. When a memory looks wrong or is unexpectedly missing, call goodmemory_trace_recall to see why it was or was not selected.
- When you learn a durable fact, decision, preference, or blocker worth keeping and the goodmemory_remember tool is available, persist it with one clear statement per call. Writes are governed and auditable; the result explains any rejection.
- Treat exported artifact files as projections, not canonical truth, and do not restate injected memory verbatim into files or commit messages.

GoodMemory complements Claude Code auto-memory: keep your own session working notes in MEMORY.md; keep durable project facts, decisions, and preferences in GoodMemory so they surface per-prompt with provenance. Do not copy hook-injected GoodMemory content into MEMORY.md.
<!-- GOODMEMORY-INSTALL:CLAUDE END -->
