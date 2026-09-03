# GoodMemory Memory Artifact and Interchange Spec

Status: normative for GoodMemory 0.8 (unpublished lane). The key words MUST,
MUST NOT, SHOULD, and MAY are to be interpreted as described in RFC 2119.

This document fixes the on-disk shapes a GoodMemory installation produces and
accepts: the Markdown artifact tree, the memoryfield-compatible page bundle,
the export envelope, the import contract, the workspace file mirror, and the
HTTP bridge operations that carry them. It is the contract other tools may
build against; ADR-010 records why these shapes were chosen.

## 1. Terms

- **Durable scope**: a `MemoryScope` without `sessionId`. Artifacts, pages,
  the mirror, and imports are all keyed by durable scope.
- **Note**: a durable `note` memory: a titled Markdown body stored verbatim,
  at most 8192 UTF-8 bytes, never sentence-split, superseded by title.
- **Bundle**: a list of `{ relativePath, content }` files with a root.

## 2. Artifact tree

`exportMemory({ scope }).artifacts` is a bundle whose `rootPath` is the scope
namespace `.goodmemory/users/<userId>[/tenants/<tenantId>][/workspaces/<workspaceId>]`
(`/sessions/<sessionId>` is appended only when a session scope is exported).
Consumers MUST treat `rootPath` as identity, not as a location; the CLI writes
the tree under `<output>/<rootPath>/`, the mirror ignores it (§6).

Files, in emission order:

| Path | Kind | Content |
|---|---|---|
| `user.md` | `user` | Compiled profile: Profile, Expertise, Current Projects And Goals, Collaboration Preferences, Stable Procedural Guidance, Provenance |
| `MEMORY.md` | `memory` | The index (§2.1) |
| `topics/preferences.md`, `topics/feedback.md`, `topics/references.md`, `topics/facts.md` | `topic` | Always present; one section per lifecycle partition |
| `topics/notes.md` | `topic` | Present when the scope holds notes; bodies verbatim |
| `topics/episodes/YYYY-MM.md` | `topic` | Present per month that holds episodes |
| `session.md` | `session` | Present for a session scope export with runtime included |
| `archive/YYYY/MM/<sessionId>.md` | `archive` | One per session archive |
| `playbooks/*.md` | `playbook` | One per promoted playbook |

All inline text passes through the Markdown sanitizer: a record MUST NOT be
able to inject a heading, list marker, or link into the artifact.

### 2.1 Index limits and line grammar

`MEMORY.md` MUST be at most 200 lines and 25 000 bytes. It opens with a
localized `## Files` section pointing at the topic files, then one localized
section per record kind. Each record line matches

```
- [<kind>] <id> <YYYY-MM-DD>[T…] <head> [evidence: <n>] | <pointer>
```

where `<head>` is the record's first line clipped to 120 characters. When the
budget would be exceeded the longest section is trimmed first and the file
ends with a localized `omitted records: <n>` line. Domain metadata such as
occurrence and tags lives in the topic files, never in the index.

### 2.2 Topic partitions

Every topic file carries the localized headings Active, Superseded, and
Archived in that order; empty partitions render as an empty list, not as a
missing heading. Record lines in topic files keep the occurrence and
domain-metadata suffixes the index omits.

## 3. Note pages

`exportMemory({ scope }).pages` is a bundle with `rootPath: "pages"`:

| Path | Kind |
|---|---|
| `pages/<slug>-<id8>.md` | `page`, one per **active** note, ordered by title then id |
| `pages/listing.md` | `listing` |
| `pages/manifest.json` | `manifest` |

`<slug>` is the lowercased title with every run of non-letter, non-digit
characters replaced by `-` (at most 48 characters, `note` when empty);
`<id8>` is the first eight `[A-Za-z0-9-]` characters of the note id after the
`note_` prefix. Colliding names get `-2`, `-3`, … suffixes.

### 3.1 Page format

A page is UTF-8 Markdown with YAML frontmatter restricted to this subset:

```
---
title: '<title>'
uuid: <note id>
created: '<createdAt>'
updated: '<observedAt ?? updatedAt>'
summary: '<attributes.summary>'        (optional)
tags: [a, 'b c']                       (optional)
goodmemory:
  kind: note
  format: markdown
  source: <source.method>
  subject: '<subject>'                 (optional)
  observedAt: '<observedAt>'           (optional)
  createdAt: '<createdAt>'
  updatedAt: '<updatedAt>'
---

<body, verbatim, newline-terminated>
```

Scalars are single-quoted with `'` doubled. A reader MUST accept unquoted,
single-quoted (`''` escape), and double-quoted (`\"`, `\\` escapes) scalars,
MUST accept an inline `tags` list whose entries may be quoted, MUST ignore
unknown scalar keys, and MUST reject any other nested mapping as
`unsupported_frontmatter`. A file that does not end in `.md` is
`not_a_page`; an empty body is `empty_body`. The title falls back to the first
Markdown heading, then to the file name.

`created` and `updated` are the memoryfield page timestamps: `updated`
carries the note's `observedAt` when present so a page imported from another
tool keeps its own timestamp across a round trip; the record timestamps live
in the `goodmemory` block.

### 3.2 Listing and manifest

`listing.md` is `# Pages` followed by one
`- [<title>](<file>) (updated <YYYY-MM-DD>)[: <summary>]` line per page, or
`(no pages)`.

`manifest.json`:

```json
{
  "format": "goodmemory.pages/v1",
  "pageCount": 1,
  "pagesSha256": "<hex>",
  "files": [{ "path": "<file>", "sha256": "<hex>", "bytes": 123, "noteId": "<id>", "title": "<title>" }]
}
```

`pagesSha256` is the SHA-256 of the sorted, newline-terminated lines
`<path> <sha256(content)>`, one per page, with `path` relative to the pages
directory. It equals the `inputSha256` an importer computes for the same files
(§5.3) and can be reproduced with shell tooling.

### 3.3 Splitting

A page whose body exceeds 8192 bytes is rejected as `note_too_large` unless
the importer asks for `oversize: "split"`. Splitting cuts at heading
boundaries, then blank-line paragraph boundaries, then whitespace, then at
code point boundaries inside a single whitespace-free run; every chunk is
titled `<title> (<i>/<n>)` and re-appends the `[label]: url` citation
definitions it references so no chunk loses its sources (the splitter keeps
that room out of the chunk budget). Chunks carry `attributes.splitOf`,
`splitIndex`, and `splitTotal`.

The cap is enforced on what is written, never assumed from the splitter: an
importer MUST check every chunk and reject the whole page as
`note_too_large` when any chunk still exceeds 8192 bytes (for example a
citation list wider than the cap).

## 4. Export envelope

`exportMemory` returns `{ scope, exportedAt, traceId?, artifacts, pages,
durable, runtime? }`. `durable` holds `profile`, `preferences`, `references`,
`notes`, `facts`, `feedback`, `episodes`, `archives`, `evidence`,
`sourceMessages?`, `experiences`, `proposals`, and `promotions`, each an array
of full records. `runtime` is present only when `includeRuntime` is true and
is summary state, never a raw transcript. The CLI writes the envelope as
`memory-export.json` beside the artifact tree and the `pages/` directory.

## 5. Import

`importMemory({ scope, source, dryRun?, oversize?, locale?, expectedSha256? })`
is a scope-fenced mutation. It writes records directly with
`source.method: "import"`; it does not run extraction, and policy
`shouldRemember` is consulted per page.

### 5.1 Pages form

`source: { kind: "pages", pages: [{ path, content }] }`. Per page, in order:
parse (§3.1) → size check (§3.3) → policy → write. Outcomes:

| Outcome | Meaning |
|---|---|
| `imported` | a new note was written |
| `superseded` | an active note with the same normalized title had a different body; it is now `superseded` with `supersededBy` pointing at the new note (`supersededMemoryId` is reported) |
| `unchanged` | a note with the derived id, or an active same-title note with the same body (trailing whitespace ignored), already exists |
| `split` | the page was written as several notes (`memoryIds`) |
| `rejected` | `not_a_page`, `unsupported_frontmatter`, `empty_body`, `note_too_large`, or `policy_should_remember_blocked` |

The note id is `note_<sha256(scopeKey + " " + identity)[:24]>_<sha256(body)[:8]>`
where `identity` is `uuid:<uuid>` when the page carries one and
`title:<normalized title>` otherwise; the scope salt keeps ids from leaking the
scope key while making re-imports idempotent.

### 5.2 Durable form

`source: { kind: "durable", durable }` restores records by id across every
collection of §4: `profile`, `preferences`, `references`, `notes`, `facts`,
`feedback`, `episodes`, `archives`, `evidence`, `sourceMessages`,
`experiences`, `proposals`, and `promotions`. The envelope is validated
before any write: every required collection MUST be an array, `profile` MUST
be `null` or a well-formed profile, and every record MUST match the runtime
schema of its record type (required fields present, enumerations such as
`lifecycle`, `source.method`, and `kind` within their sets, timestamps
parseable, lists and attribute maps correctly typed); otherwise the call
throws `invalid_durable: <collection>[<index>].<field>: <problem>` naming the
first offending field. Unknown extra fields are ignored by validation and
written through unchanged, so an envelope from a newer release still imports.
Operator confirmation (`--yes`, `expectedSha256`) attests to the input's
origin, never to its shape. A record whose
scope fields do not match the request scope fails the whole import with
`outcome: "rejected"`, `reason: "scope_mismatch"` before any write. Existing
identical records count as `unchanged`; existing records with the same id but
different content count as `conflicts` and are skipped. Recall projections
are rebuilt for restored records; claim projections are appended at remember
time and are not rebuilt by import.

### 5.3 Input hash and dry run

`inputSha256` is the pages hash of §3.2 for the pages form and the SHA-256 of
the JSON-serialized `durable` section for the durable form. When
`expectedSha256` is present and differs, the call throws
`import_hash_mismatch` before any write. Text the canonical store cannot hold
(NUL bytes, lone surrogates) anywhere in the input is refused before any
write. `dryRun: true` returns the same report with `outcome: "dry_run"` and
writes nothing.

### 5.4 Failure

An import either completes or leaves the scope as it found it. Records are
written first, embeddings next, and the vectors of superseded notes are
removed last; if any step throws, every record the call wrote is deleted,
every note it superseded is restored, and the error is rethrown, so the
same input can be re-run. Only a process crash between the record writes and
the embedding writes can leave records without vectors; they remain
lexically indexed and re-import reports them `unchanged`.

The CLI (`goodmemory import-memory --input <dir|page.md|memory-export.json>`)
refuses to write unless `--yes` or `--expect-sha256 <hex>` is given; a
`manifest.json` beside the pages is reported as matching or differing but
never trusted on its own.

## 6. Workspace file mirror

When `governance.fileMirror: { root, scope, debounceMs? }` is configured
(installed hosts: `fileMirror: { enabled, root? }` in the managed config, or
`goodmemory setup --file-mirror`, root defaulting to
`<workspaceRoot>/.goodmemory/memory` and `scope` to the workspace's
`{ userId, workspaceId }`), every fenced durable mutation inside `scope`
schedules a regeneration of the artifact tree (§2, written directly under
`root`, `rootPath` ignored) and the page bundle (§3) for that scope.
Regeneration is debounced, writes to a sibling staging directory, swaps it in
with two renames, and removes the previous tree; if the swap fails the
previous tree is put back and the staging directory removed.

One root serves exactly one durable scope: the bound `scope` (its `sessionId`
is ignored). A mutation belongs to the mirror when every field the bound
scope fixes matches; fields it leaves unset admit any value, so a
`{ userId, workspaceId }` binding is regenerated by every agent writing into
that workspace and never by another user or workspace. The mirror is a
projection. GoodMemory MUST NOT read it back, and a mirror failure MUST NOT
fail the mutation (it is traced as a failed `governance.file_mirror` span).

## 7. Prompt fragment frame

`buildContext` prompt fragments (`system_prompt_fragment`,
`developer_prompt_fragment`) open with the fragment title followed by the
localized `memory_context_frame` line whenever at least one section survives
trimming. The frame reserves its own tokens within `maxTokens`. `json` and
`markdown` outputs never carry it. It can be disabled with
`governance.contextFrame: false` or per call with `contextFrame: false`;
`BuildContextResult.contextFrame` is `true` when it was rendered. The frame
states what the text is; it is not a security guarantee.

## 8. HTTP bridge operations

| Operation | Path | Authorization |
|---|---|---|
| `export` | `POST /memory/export` | explicit |
| `import` | `POST /memory/import` | explicit |
| `revise` | `POST /memory/revise` | explicit |
| `forget` | `POST /memory/forget` | explicit |

`/memory/import` accepts the §5 input with at most 200 pages and 64 KiB per
page, answers `409 import_hash_mismatch` on an expected-hash mismatch, and is
listed under `http.endpoints.import` in the capability descriptor. The
contract version is `phase-39.http-memory.v1`.

## 9. Data exposure

Artifacts, pages, envelopes, and mirrors are the whole durable scope. Redaction
hides values, not existence: ids, timestamps, and content hashes still reveal
that a record exists. Do not distribute them for scopes whose contents must
not leak; treat `inputSha256` as an integrity check, not as proof of origin.

## 10. Versioning

`manifest.json#format` is `goodmemory.pages/v1`; `goodmemory --schema` prints
`schemaVersion: "goodmemory.cli/v1"`; the recall projection pipeline that
indexes notes is `gm-projection-v6`. A breaking change to any shape in this
document bumps the corresponding version string and is recorded in an ADR.
