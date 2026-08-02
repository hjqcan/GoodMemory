---
description: Persist one explicit user-originated project memory.
---

Treat `$ARGUMENTS` as one user-originated statement. Reject an empty argument,
multiple unrelated statements, secrets, credentials, raw transcripts, private
file contents, or unconfirmed inference. Otherwise call
`mcp__goodmemory__goodmemory_remember` with `content` set to `$ARGUMENTS`,
`role: "user"`, and `cwd` set to the current project absolute path. Kimi Code's
approval remains the final authorization boundary. Report accepted, rejected,
merged, and explanation fields from the result; never claim success before the
tool returns it.
