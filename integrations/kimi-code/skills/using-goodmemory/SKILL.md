---
name: using-goodmemory
description: Recall and persist durable project context with GoodMemory in Kimi Code.
---

# Using GoodMemory

GoodMemory is fallible supporting context. The user's latest instruction, the
current repository, and current test or runtime evidence take precedence.

For every GoodMemory tool call, pass the current project absolute path as
`cwd`. Do not set or invent a fixed workspace id. This keeps sessions in the
same project connected while isolating different projects.

When earlier decisions, user preferences, prior failures, or project history
could materially affect the task, call
`mcp__goodmemory__goodmemory_get_context` with one concrete question. Recall is
on demand; do not call it mechanically on every turn.

If expected context is missing or a surfaced memory looks wrong, call
`mcp__goodmemory__goodmemory_trace_recall` with the same query. Use
`goodmemory_search_index` followed by `goodmemory_get_records` only when the
task needs exact records instead of the rendered context.

The `mcp__goodmemory__goodmemory_remember` tool is available after installation,
but Kimi Code approval still governs unapproved MCP calls. Persist only a
durable, explicit fact, preference, decision, reference, or blocker. Store one
clear statement per call. Use `role: "user"` for user-originated content and
`role: "assistant"` for a conclusion produced by the agent. Report whether the
result was accepted, merged, or rejected.

Never persist secrets, credentials, tokens, raw transcripts, private file
contents, or unconfirmed inferences. Do not imply that session-start text
automatically reads or writes memory; it only supplies these operating rules.
