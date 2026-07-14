# GoodMemory

Language: English | [简体中文](./README.zh-CN.md)

GoodMemory is a memory layer for AI products and coding agents.

It gives chat apps, copilots, and agent hosts a durable user/project memory loop:
write selected facts, retrieve the right context, inject it into the next turn,
audit what happened, and delete it when it is wrong.

GoodMemory is not an LLM, agent framework, vector database, or generic RAG
system. It is the product memory layer between your app or installed agent host
and the model runtime.

## What You Get

- Durable memory API: `remember`, `recall`, `buildContext`, `feedback`, `forget`,
  `exportMemory`, and `deleteAllMemory`.
- Installed agent memory for Codex and Claude Code through `goodmemory setup`,
  managed hooks, installed Codex pre-action, `goodmemory status`, read-only
  MCP, and opt-in writeback.
- Public write customization with `GoodMemoryConfig.remember`,
  `RememberProfile`, `rememberRules`, `RememberInput.annotations`, and named
  extractor ids.
- Package exports for `goodmemory`, `goodmemory/ai-sdk`, `goodmemory/host`,
  and `goodmemory/http` through compiled `dist` artifacts and TypeScript
  declarations.
- Local-first storage: Bun gets durable SQLite by default; explicit Postgres,
  injected adapters, and embedding providers can be added when needed.
- Evaluation and release evidence paths for deterministic tests, live evals,
  provider-backed evals, package smoke tests, and quality gates.

## Start Here: Codex Or Claude Code

```bash
npm install -g goodmemory@0.5.1
goodmemory setup
```

No account or hosted service is required. GoodMemory stores memory locally in
SQLite by default, wires lifecycle hooks plus read-only MCP inspection, and
keeps durable writeback opt-in. Verify the installation with
`goodmemory status`.

Using another MCP client or integrating an application? [Choose an integration
path](#choose-your-integration-path).

## Benchmark Results

GoodMemory separates current-production claims, versioned historical evidence,
and internal research. A number may enter the current-claims table only after
`gate:public-benchmark-claim --strict` validates a committed declaration for
the current package version: complete coverage, `executionFailures: 0`, a
no-memory baseline, deterministic scoring or an independent judge, verified
dataset source and license, and a reproducible run (commit + command + package
version). Historical rows remain under separate markers and cannot satisfy the
current-version gate.

The Phase 72 `v0.6.0` generalized refresh is still open. Current reruns do not
show a uniform score increase: MemoryAgentBench CR/TTL are
0.9589041096/0.9333333333. ImplicitMemBench Full-300 scored 0.6683666667 and
0.6790333333 on two independent `gpt-5.4` judging passes; an explicitly
disclosed four-case LogiQL retry merge reached 0.6923666667 with zero failures,
but remains internal evidence rather than a replacement full-run claim. BEAM's
generalized full-400 evidence recall is 0.8273942646; a stored-retrieval retry
after a generic subject-date guardrail raised the 20-case official-protocol
slice from 0.7766666667 to 0.8266666667 (59/59 rubric items, zero judge
failures). HaluMem's frozen slice now beats its local vector baseline on all
three official metrics: extraction 0.9309950438 vs 0.8615384615, update 0.75 vs
0.625, and QA 0.8888888889 vs 0.7777777778. LongMemEval now has a current
zero-failure full-500 `goodmemory-recommended` run with bounded, monotonic
query-tail evidence expansion: `gpt-5.6-terra` answers score 340/500 = 0.680
under an independent `gpt-5.4` official-protocol rescore, while its judge-free
deterministic lower bound is 269/500 = 0.538. This raised the assistant category
from 39/56 to 46/56 while every other category held within 1pt, but both
headline tracks still miss the required 0.92 / 0.72 gates. LoCoMo's current
full-1540 production run also
misses its strict and official score gates. These remain internal research
results, so the table below retains versioned historical evidence with its
disclosed profiles.

<!-- current-claims-table:start -->
<!-- current-claims-table:end -->

### Versioned historical claims (not current-production results)

These rows remain reproducible evidence for the disclosed package version and
runtime profile. They are not claims about the current production-generalized
path. The runtime capability descriptor keeps `benchmarks.currentClaims` empty
until a current-version full gate explicitly promotes a replacement result.

<!-- historical-evidence-table:start -->
| Benchmark | Primary metric | GoodMemory result | Baseline / reference | Claim declaration |
|---|---|---:|---:|---|
| LongMemEval full 500 | strict: judge-free deterministic subset · comparable: official LongMemEval judge protocol | strict **0.720** (360/500) · official-protocol **0.888** (444/500), `goodmemory-rules-only` | no-memory 0.068; current Mem0 harness: 94.4 Top200 / 94.8 Top50 (different stack and budget) | [longmemeval.json](./benchmark-claims/longmemeval.json) |
| MemoryAgentBench (CR, TTL) | answer accuracy — deterministic, judge-free | **CR 0.959, TTL 0.767** | no-memory ablation 0.000; published single-hop CR ceiling ~0.60 | [memoryagentbench.json](./benchmark-claims/memoryagentbench.json) |
| LoCoMo (full 10 conversations) | strict: deterministic token-F1 · comparable: industry LLM-judge protocol (non-adversarial 1540) | strict **0.6117** (942/1540) · judge-protocol **0.837** (1289/1540) | no-memory 0.0045 non-adversarial; current Mem0 harness: 92.5 Top200 / 91.8 Top50 (different stack and budget) | [locomo.json](./benchmark-claims/locomo.json) |
| BEAM 100K (400 questions, 1051 rubric items) | official BEAM rubric judge (1.0/0.5/0.0 per rubric item) · strict: internal binary judge | official-protocol **0.802** · strict binary **0.7225** (289/400) | no-pack ablation 0.5725; only public same-protocol reference: 0.49 | [beam.json](./benchmark-claims/beam.json) |
| ImplicitMemBench Full-300 | stored-answer cross-version judge rescore | **0.691** (207.35/300), gpt-5.4 judge over gpt-5.5 answers, sourceAnswersUnchanged | upstream-chat baseline **0.400** (120/300); reference line 0.66 | [implicitmembench.json](./benchmark-claims/implicitmembench.json) |
<!-- historical-evidence-table:end -->

Where both are available, each historical row reports two tracks. The
**strict** track is deterministic or judge-free — a hard lower bound no LLM
judge can inflate. The **comparable** track re-judges the *same stored answers*
(not regenerated) under each benchmark's official or industry-standard judge
protocol, verbatim, so the number sits on the same scale as published
competitor results. The gap between the tracks is quantified judge leniency,
disclosed instead of hidden. Comparable-track judging uses gpt-5.4 — a
different model from the historical gpt-5.5 answerer but the same family;
every per-protocol detail is recorded in the linked declarations.

The historical LongMemEval strict result is judge-free, replacing an earlier
internal with-judge number (0.908) that is superseded and not claimable. A case counts as correct
only when a deterministic method scores it (abstention / exact / contains /
expected_alternative / numeric_count); the eval pipeline's same-model semantic
judge (gpt-5.5 judging gpt-5.5) is excluded by construction — with it, the
diagnostic overall accuracy is 0.896, reported for transparency but not
claimed. The recorded 0.720 (360/500, `executionFailures: 0`, v0.3.5) uses the
embedding-free `goodmemory-rules-only` profile; abstention contributes only 28
of the 360 correct answers, while the no-memory baseline's 0.068 is mostly bare
abstention (30 of its 34 correct), so the +65.2-point lift is the memory
system's contribution. Judge-free refers to scoring — answers are still
generated by gpt-5.5. Full provenance is in the
[claim declaration](./benchmark-claims/longmemeval.json).
The historical MemoryAgentBench declaration is deliberately scoped. It records
only Conflict Resolution (CR 0.959) and Test-Time Learning (TTL 0.767): a
no-memory ablation scores both `0.000` (the
questions are unanswerable without GoodMemory's retrieved consolidated fact /
in-context demos), so these are genuine memory contributions, scored
deterministically with no LLM judge (`executionFailures: 0`, 259 questions).
Accurate Retrieval and Long-Range Understanding are EXCLUDED: the no-memory
ablation scores them *higher* (AR 0.926 vs 0.890; LRU 0.632 vs 0.518), so they
are multiple-choice leaks where the model answers from the candidates in the
question, not memory wins. CR/TTL measure answer-time current-value resolution
and in-context retrieval, not general retrieval recall.

The historical LoCoMo strict result is scored by deterministic token-F1 (judge-free,
`executionFailures: 0` across all 1986 questions of the full 10-conversation
set, v0.3.5). The profile is disclosed and opt-in — provider-embedding semantic
candidate union (`retrieval.semanticCandidates`, topK 16) plus conversational
write-time extraction plus an abstention-format answer prompt; the
embedding-free default scores 0.020 on the representative conv-1 slice (the
banked retrieval boundary), so this result is specifically about the
embedding+extraction profile, not the zero-dependency default. Read the memory
lift on the non-adversarial split (0.6117 vs 0.0045 — 942 vs 7 correct of 1540):
the adversarial category (446 questions whose gold answer is the literal
abstention string) is trivially aced by a no-memory arm that always abstains
(0.998 vs 0.648 with memory), so the overall-vs-overall comparison (0.6198 vs
0.2276) understates the memory contribution on answerable questions. Answers
are generated by gpt-5.5 — judge-free refers to scoring. The LoCoMo dataset is
CC BY-NC 4.0 (non-commercial scope) and is fetched at eval time, never
vendored. Full provenance is in the
[claim declaration](./benchmark-claims/locomo.json).

The historical BEAM 100K result is retained as versioned evidence but is not a
current public-claim row because its recall path used the repo-only
`legacy-fitted` profile. It was scored under the benchmark's official unified rubric judge:
each of the 1,051 rubric items is scored 1.0/0.5/0.0 and a question's score is
the mean over its items (all 400 questions, `judgeFailures: 0`). The only
public end-to-end BEAM 100K number scored the same way is 0.49; GoodMemory
scores 0.802 (+31 points), with per-category detail in the declaration —
including the one category below that reference (instruction_following 0.394
vs 0.66), disclosed rather than averaged away. The strict internal
binary-judge track is 0.7225 vs a 0.5725 no-evidence-pack ablation (the
answer-time evidence pack contributes +15 points). Recall is dual-metric per
[ADR-005](./adr/ADR-005-scenario-fitted-recall-boundary.txt): rules-only
fitted 0.9621 vs generalization floor 0.6822 with all 148 scenario-fitted
gates disabled (the shipped opt-in semantic-candidate union lifts that floor
to 0.8529). One protocol deviation is disclosed: the paper pipeline scores
event_ordering with a rank-correlation metric; both this run and the public
reference rubric-judge it. Dataset CC BY-SA 4.0, fetched at eval time, never
vendored.

The historical ImplicitMemBench Full-300 declaration uses the canonical zero-failure
`run-phase61-full300-rerun-20260706-codex-current` answers, then re-scores the
same stored answers with gpt-5.4 (`sourceAnswersUnchanged: true`). The judge is
cross-version but the same GPT family as the gpt-5.5 answer model, not a
cross-family judge. The recorded score is **0.691** (207.35/300) versus an
upstream-chat baseline of **0.400** (120/300), with 530 judge-required row
decisions across the baseline and GoodMemory arms; deterministic
`structured_first_action` rows are carried forward rather than judged. The
older same-model diagnostic score was 0.708 and is not the recorded result. The
freshest clean answer-regeneration drift check after recent code changes scored
0.6895 with `executionFailures: 0`; it shows current checkout drift, not a
replacement for the stored-answer comparability artifact. Dataset CC BY 4.0,
fetched at eval time, never vendored.

### Internal diagnostics (not public claims)

Blocked benchmark numbers stay out of the current-claims table until their
declaration has `candidate_public_claim` status for the current package version
and `gate:public-benchmark-claim --strict` passes. The underlying run reports
live under gitignored `reports/` and are reproducible from the run commands
recorded in the declarations.

Use [task-board/00-README.txt](./task-board/00-README.txt) for execution order
and
[docs/GoodMemory-Current-Status-and-Evidence.md](./docs/GoodMemory-Current-Status-and-Evidence.md)
for claim boundaries.

## Choose Your Integration Path

GoodMemory has three primary product entry points. They are not the only APIs:
lower-level surfaces such as `goodmemory/host`, custom stores, eval tooling, and
runtime helpers support these paths. They are the README-level ways to decide
how to start.

### Autonomous agent? Start here

If you are an agent that wants to give *yourself* durable memory, match one path
and run it. Machine-readable versions of this tree live in
[llms.txt](./llms.txt) and
[.well-known/goodmemory.json](./.well-known/goodmemory.json) (a deployed bridge
also serves the descriptor at `/.well-known/goodmemory.json`).

- **You are, or run inside, Claude Code or Codex** →
  `npm install -g goodmemory@0.5.1 && goodmemory setup`. Unsure what is already
  wired? Run `goodmemory adopt` (add `--json` for a machine-readable plan): it
  inspects `.claude/`, `.codex/`, and existing MCP config, then prints the exact
  next command for your environment.
- **You speak MCP** (Cursor, Windsurf, Cline, Claude Desktop, Gemini CLI,
  OpenCode, or a custom client) → add the
  [standalone MCP server](#standalone-mcp-for-any-client); the two tools you need
  are `goodmemory_get_context` (recall) and `goodmemory_remember` (opt-in write).
- **You are a framework agent or a backend** → call the
  [HTTP bridge](#pythonfastapi-http-bridge): hosted at `goodmemory.vibenest.net`
  or self-hosted with `goodmemory-http-bridge --recommended` (or
  `GOODMEMORY_PROFILE=agent-recommended goodmemory-http-bridge`); Python callers
  use `pip install goodmemory-client`.

The prose paths below expand each option.

### 1. Build Memory Into An Agent, Chatbox, Or Copilot

Use this when you own the product server and the model call. Install
`goodmemory` in your Node/Bun service, create one `memory` instance, and pass a
stable `scope` such as `userId`, `workspaceId`, `sessionId`, and optionally
`agentId`.

The request flow is:

1. Before the model call, run `recall()` for the current scope and query.
2. Run `buildContext()` to turn recall hits into a prompt fragment.
3. Call your model with that memory context.
4. After the response, write selected signals with `memory.jobs.enqueueRemember()`
   or `remember()`.
5. Use `feedback()`, targeted `reviseMemory()`, `forget()`, and `exportMemory()`
   for correction, deletion, and user audit.

If your server already uses Vercel AI SDK, use `goodmemory/ai-sdk` to wrap
`generateText()` or `streamText()` instead of hand-wiring the whole loop. Start
with [App Quickstart](#app-quickstart), then read
[AI SDK Adapter](#ai-sdk-adapter) if you use AI SDK.

### 2. Add Memory To Codex Or Claude Code

Use this when you want an installed coding agent to remember project and user
context without changing the agent itself. Install the global CLI and run
`goodmemory setup`.

The installed-host flow is:

1. `session-start` injects a session brief; `user-prompt-submit` injects
   per-prompt context (relevance-gated on fresh installs so low-signal prompts
   stay clean).
2. The Claude Code `Stop` hook captures each turn from the session transcript
   (`transcript_path`) into governed writeback candidates — bounded, redacted,
   never raw transcripts; for Codex, `goodmemory codex writeback --from-rollout`
   feeds the newest session rollout through the same pipeline.
3. Codex `pre-tool-use` can deny or redirect risky Bash through
   `goodmemory codex action` on the same installed config and storage path.
4. MCP gives trace, context, stats, and artifact inspection; the
   `goodmemory_remember` write tool is opt-in via `mcp.allowWrite` (or
   `goodmemory enable <host> --mcp-allow-write`).
5. Writeback stays `off` for scripted installs; interactive install and
   `goodmemory setup --recommended` (one consent prompt) enable `selective`
   durable writes — auditable via `writeback inspect`, reversible via
   `writeback forget --event-id`.
6. Fresh installs start on the measured BM25 hybrid retrieval tier with a
   1024-token session brief and 512-token gated prompt injection; `goodmemory
   status` shows the retrieval tier, capture proof-of-life, and injection
   telemetry. Optional `sharedAgents` config lets one host read the other
   host's records (writes stay attributed).

Start with [Quickstart: Codex Or Claude Code Memory](#quickstart-codex-or-claude-code-memory).
Use [Installed Host Writeback](#installed-host-writeback) when you are ready to
review or enable writes.

### 3. Deploy GoodMemory As A Backend Memory-Layer Service

Use this when another backend should call GoodMemory as a service, especially
when the product backend is Python/FastAPI or when a product such as OneLife
should keep memory server-side instead of bundling GoodMemory into a mobile or
browser client.

Deploy the packaged `goodmemory-http-bridge` in a Node/Bun sidecar. Your backend
then calls:

- `/memory/recall-context` before its own model call
- `/memory/remember` after a user-confirmed or product-approved signal
- `/memory/feedback` for procedural corrections
- `/memory/export` and `/memory/forget` for audit and deletion
- `/memory/revise` for targeted correction by explicit memory id

Your service still owns auth, product policy, UI, and model orchestration.
GoodMemory owns memory storage, recall, context assembly, write governance, and
audit/export/delete behavior. Start with
[Python/FastAPI HTTP Bridge](#pythonfastapi-http-bridge) — the official Python
client (`pip install goodmemory-client`) and a hosted bridge instance at
`goodmemory.vibenest.net` are documented there — then check
[Runtime And Storage](#runtime-and-storage) for SQLite/Postgres choices.

During a model turn, GoodMemory does four jobs:

1. Resolve memory for the current `scope`.
2. Build a prompt-ready context fragment.
3. Record selected post-response signals when your app or host allows it.
4. Provide audit, correction, export, and deletion paths for user control.

Your app or installed agent still owns auth, UI, model calls, and product
policy. GoodMemory owns the memory loop and storage boundary.

## Install

GoodMemory `0.5.1` has two normal install paths.

Use the global CLI when you want memory enhancement inside installed coding
agents:

```bash
npm install -g goodmemory@0.5.1
goodmemory setup
goodmemory status
```

Use the package dependency when you are building an application:

```bash
npm install goodmemory@0.5.1
```

If you want to type `goodmemory` directly, install the global CLI.
A project-local `npm install goodmemory@0.5.1` does not put `goodmemory` on your shell `PATH`.
Use `npx goodmemory`, `npm exec -- goodmemory`, or `./node_modules/.bin/goodmemory`
from that project instead.

```bash
npx goodmemory -V
```

Bun consumers can install it directly:

```bash
bun add goodmemory@0.5.1
```

Tarball verification for release rehearsal:

```bash
npm install ./goodmemory-0.5.1.tgz
```

The installed CLI is Bun-backed for non-version commands. The package bin is
Node-safe for `goodmemory -V` and `goodmemory --version`; other commands
delegate to Bun.

## Quickstart: Codex Or Claude Code Memory

For most users, the first useful path is installed-host memory.

```bash
npm install -g goodmemory@0.5.1
goodmemory setup
goodmemory status
```

`goodmemory setup` detects Codex and Claude Code, installs managed host wiring,
and asks for:

- host: `codex`, `claude`, or both detected hosts
- activation: global, current workspace, or manual opt-in
- GoodMemory user id
- optional Postgres storage
- optional embedding provider
- optional LLM extraction provider
- writeback mode: `off`, `observe`, `review`, or `selective`

Interactive setup defaults to global activation with workspace-derived
isolation and recommends `selective` for new host configs so high-signal writes
start working immediately with audit and undo. Choose `review` when you want
Inspector approval before durable writes. Existing host configs keep their
current writeback mode when the interactive prompt default is accepted.
Scripted installs stay safe with `--json` or `--no-interactive`.
Skipping provider setup is valid: GoodMemory still works with local SQLite and
rules-only extraction.

Useful commands:

```bash
goodmemory setup --host codex
goodmemory status codex --workspace-root .
goodmemory enable codex --workspace-root . --writeback observe
goodmemory enable codex --workspace-root . --writeback selective
goodmemory disable codex --workspace-root .
goodmemory uninstall codex
```

The installed host path has four pieces:

- Managed pre-action for Codex: `pre-tool-use` can deny or redirect risky Bash
  and `goodmemory codex action` executes the vetted first step on the same
  installed config, storage, provider, and scope path used by recall and
  writeback.
- Recall injection: `session-start` and `user-prompt-submit` hooks call
  `recall()` plus `buildContext()` and fail open if config, parsing, or storage
  is unavailable.
- Deep inspection: `goodmemory mcp serve --host codex` and `goodmemory-mcp
  --host codex` expose read-only context, trace, stats, and artifact tools.
- Optional writeback: `session-stop` and explicit writeback commands can turn
  selected after-response signals into durable memory.

## Standalone MCP For Any Client

Hosts without a managed install path (Cursor, Windsurf, Cline, Claude Desktop,
Gemini CLI, OpenCode, or your own MCP client) can run the same MCP server in
standalone mode — no `goodmemory setup`, no host config files. Scope and
storage come from flags/env; the served surface is the same 8 read-only tools,
plus an opt-in governed write tool:

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

Equivalent invocation: `goodmemory-mcp --standalone --user-id <id>` (requires
Bun on PATH; `GOODMEMORY_USER_ID` works as the flag's env fallback).
`--allow-write` (or `GOODMEMORY_MCP_ALLOW_WRITE=1`) registers
`goodmemory_remember`, which writes through the normal governed remember
pipeline. Agent-tagged memories written by installed hosts stay private to
their agent; add `--agent-id codex` plus the shared `--storage-url` to opt into
reading an installed host's store. Full flag/env matrix, scope notes, and
per-host recipes:
[docs/GoodMemory-Standalone-MCP-Setup-Guide.md](./docs/GoodMemory-Standalone-MCP-Setup-Guide.md)
([Cursor](./docs/GoodMemory-Cursor-Setup-Guide.md) ·
[Gemini CLI](./docs/GoodMemory-Gemini-CLI-Setup-Guide.md) ·
[OpenCode](./docs/GoodMemory-OpenCode-Setup-Guide.md)).

## Installed Host Writeback

Installed Host Writeback is opt-in. Runtime config defaults and new scripted
installs remain `off` unless the user explicitly chooses a writeback mode.
Existing configs keep their current writeback mode when no explicit override is
provided. New interactive installs recommend `selective` so high-signal writes
start working immediately with audit and undo; choose `review` when you want
Inspector approval before durable writes.

Use `observe` before `selective`:

```bash
goodmemory enable codex --writeback observe
goodmemory codex writeback --json

goodmemory enable codex --writeback review
goodmemory inspector serve

goodmemory enable codex --writeback selective
goodmemory codex writeback --json
```

`goodmemory inspector serve` opens the built-in local React console for users
and scopes, categorized memory and supersession history, candidate decisions,
recall evidence traces, and audit events. The startup token is passed in a URL
fragment, cleared immediately into session storage, and sent only as a Bearer
header. Revision and destructive actions require confirmation, ETags, and
idempotency keys. See
[Inspector And Admin API](./docs/GoodMemory-Inspector-and-Admin-API.md).

Writeback rules:

- `off`: no after-response memory extraction.
- `observe`: store local bounded/redacted candidate previews for review without
  raw transcripts or durable memory writes.
- `review`: queue bounded/redacted candidates for Inspector approval; no durable
  memory is written until an operator approves a candidate.
- `selective`: write selected candidates through the public `remember` surface.
- Raw transcripts are not persisted as memory.
- Assistant-originated durable memory is blocked unless the host confirms or
  verifies it and the active profile allows it.
- `remember: "never"` masks annotated content before deterministic, custom, or
  assisted extraction.

Audit and undo:

```bash
goodmemory codex writeback inspect --json
goodmemory codex writeback forget --event-id <event-id> --review-outcome false_write
```

The audit ledger stores bounded redacted candidate previews, candidate keys,
typed linked record ids, status, reasons, host, mode, timestamps,
scope/session digests, and optional manual review metadata. It does not store
raw host payloads. `forget --event-id` deletes linked memory/evidence records
through public `forget()` before marking durable audit events forgotten; for
observe-only events it marks the candidate dismissed without calling
`forget()`.

Claude Code has deterministic CLI parity for hook and writeback commands;
Codex is the canonical live-evidence path.

## Scripted Host Install

Use `goodmemory install <host>` when you want a fully non-interactive setup:

```bash
goodmemory install codex \
  --user-id <user-id> \
  --activation-mode global \
  --writeback observe \
  --storage-provider postgres \
  --storage-url "postgres://user:pass@host:5432/goodmemory" \
  --embedding-provider openai \
  --embedding-model text-embedding-3-small \
  --embedding-api-key <key> \
  --llm-provider openai \
  --llm-model gpt-4o-mini \
  --llm-api-key <key> \
  --no-interactive
```

Managed config lives under `~/.goodmemory/<host>.json`. Re-running install with
provider flags updates the same config and keeps MCP/hook registration
idempotent. Package uninstall does not delete `~/.goodmemory`, repo-local
`.goodmemory`, local SQLite files, or remote Postgres data. Use
`goodmemory uninstall <host>` to remove managed host wiring, and use
`goodmemory forget ...` or explicit storage deletion to remove memory data.

## App Quickstart

Use the root package when you are building a chatbox, copilot, or product agent.
The recommended Node service path is the same thin loop used by the Express and
Fastify examples. A longer walkthrough lives in
[docs/GoodMemory-15-Minute-App-Integration.md](./docs/GoodMemory-15-Minute-App-Integration.md).

```ts
import type { GoodMemoryTraceSpan } from "goodmemory";
import { createGoodMemory } from "goodmemory";

const traceSpans: GoodMemoryTraceSpan[] = [];

const memory = createGoodMemory({
  observability: {
    traceSink: {
      emit(span) {
        traceSpans.push(span);
      },
    },
  },
});

const scope = {
  userId: "u-1",
  workspaceId: "workspace-a",
  sessionId: "s-1",
};
const userMessage = "Remember that the migration rollout is blocked on QA signoff.";

// Call startSession once when the product opens a new session. For later turns
// with the same sessionId, append to the existing runtime state instead.
await memory.runtime.startSession({ scope });
await memory.runtime.appendMessage({
  scope,
  message: {
    role: "user",
    content: userMessage,
  },
});

const recall = await memory.recall({
  scope,
  query: "What should the assistant know before replying?",
  retrievalProfile: "general_chat",
});
const context = await memory.buildContext({
  recall,
  output: "system_prompt_fragment",
});

const assistantText = await callYourModel({
  memoryContext: context.content,
  userMessage,
});

await memory.runtime.appendMessage({
  scope,
  message: {
    role: "assistant",
    content: assistantText,
  },
});

const writeJob = await memory.jobs.enqueueRemember({
  scope,
  messages: [
    {
      role: "user",
      content: userMessage,
    },
    {
      role: "assistant",
      content: assistantText,
    },
  ],
  idempotencyKey: "turn-1",
  reason: "post_response_memory_write",
});
const drained = await memory.jobs.drain({ maxJobs: 1 });
const committedJob =
  drained.jobs.find((job) => job.jobId === writeJob.jobId) ?? writeJob;

console.log({
  traceCount: traceSpans.length,
  writeJobId: writeJob.jobId,
  writeJobStatus: committedJob.status,
});

async function callYourModel(input: {
  memoryContext: string;
  userMessage: string;
}): Promise<string> {
  void input.memoryContext;
  return `Got it. I will keep that in mind: ${input.userMessage}`;
}
```

The core memory loop is intentionally small:

- `remember()` writes selected user, app, or host signals.
- `recall()` retrieves scoped memory for a query.
- `buildContext()` turns recall hits into a prompt fragment or JSON payload.
- `feedback()` records explicit corrections and procedural preferences.
- `forget()` deletes wrong or obsolete memory.

For production app integrations, the recommended turn loop adds the governed
runtime layer around that core:

- `memory.runtime.startSession()` and `memory.runtime.appendMessage()` track
  current-session state without making raw transcripts durable memory.
- `memory.jobs.enqueueRemember()` schedules after-response memory writes with
  idempotency and visible job status.
- `memory.jobs.drain()` commits queued writes in this in-memory scheduler. In a
  production service, run draining in your worker or request-adjacent job loop.
- `GoodMemoryConfig.observability.traceSink` receives redaction-safe traces for
  remember, recall, context, revise, forget, export, and job events.
- `memory.reviseMemory({ target: { memoryId } })` corrects a known memory by
  explicit id, not by fuzzy text selection.
- `exportMemory()` gives the user an audit/export path.

Runtime archive persistence is off by default. If you call
`memory.runtime.endSession({ scope, archive: "off" })`, session state is
cleared without writing an archive. If you opt into archive persistence, keep it
summary-only and never treat raw transcripts as the default memory source.

For server integrations, start with the thin examples:
[examples/express-chat-server.ts](./examples/express-chat-server.ts) or
[examples/fastify-chat-server.ts](./examples/fastify-chat-server.ts).
For Python/FastAPI backends, use the packaged `goodmemory-http-bridge` path
described below.

## Opt-In Recall Tuning: Generalized Fusion, Multi-Hop, Optional Embeddings, And Conversational Extraction

The knobs below are optional and conservative by design. Default recall is
single-pass and rules-only, and default extraction is unchanged; nothing happens
unless you opt in. The recommended preset has a provider-free local path;
embedding and extraction providers add optional channels but are not required.

### One-flag recommended retrieval preset

`retrieval.preset: "recommended"` enables generalized retrieval and conditional
conversational extraction with one flag:

```ts
const memory = createGoodMemory({
  retrieval: { preset: "recommended" },
});
```

When active it (a) indexes memory-, field-, and sentence-granularity recall
documents, (b) fuses BM25, direct entity adjacency, and any available neural
dense candidates with RRF, (c) applies a bounded dynamic candidate budget, and
(d) biases `auto` recall routing to hybrid. An explicit per-call strategy still
wins, including `strategy: "rules-only"`, which bypasses generalized fusion.
When a neural embedding resolves, it contributes a dense `topK: 16` channel;
without one, retrieval stays local, deterministic, and zero-network. The preset
also flips assisted extraction to `mode: "conversational"` only when an
extraction model already resolves and no explicit mode was set. It never
injects a provider. Leaving `preset` unset preserves the existing rules-only
default.

Requirements and boundaries:

- No provider is required. A neural embedding endpoint
  (`GOODMEMORY_EMBEDDING_*`, `providers.embedding`, or
  `adapters.embeddingAdapter`) adds the optional dense channel. The zero-egress
  neural path is the Ollama recipe below.
- `createLocalEmbeddingAdapter()` is rejected when paired with the preset:
  hashed-lexical vectors would duplicate lexical evidence while pretending to
  be a dense semantic channel.
- Check `inspectGoodMemoryRuntime(memory).retrievalPreset` — its `extraction`
  field reports whether the write-time half engaged (`"conversational"`) or an
  extractor was unavailable/kept as-is.
- The preset covers memory retrieval and conditional extraction only.
  Answer-side prompting and abstention policy remain application concerns.
- Do not pair it with `bm25Ranking: true` unless you intentionally want the
  separate legacy additive BM25 slot; generalized fusion already has a BM25
  channel.
- If you use env-resolved extraction and adopt the preset, write-time output
  becomes conversational atomic claims; the escape hatch is an explicit
  `providers.extraction` object with `mode: "default"`.

### Optional pointwise reranker

Add a first-party OpenAI-compatible pointwise reranker when the fused candidate
set is useful but its final order is noisy:

```ts
const memory = createGoodMemory({
  retrieval: { preset: "recommended" },
  providers: {
    reranking: {
      provider: "openai",
      model: process.env.RERANKING_MODEL!,
      apiKey: process.env.RERANKING_API_KEY!,
      baseURL: process.env.RERANKING_BASE_URL,
    },
  },
});

const result = await memory.recall({ scope, query });
console.log(result.metadata.retrievalTrace?.reranker);
```

Each selected fact is scored in an independent query-document call; sibling
candidates are never placed in the same reranker prompt. The reranker only
reorders facts already admitted by deterministic recall, so it cannot widen
membership or relax grounded abstention. Provider timeout, schema, or gateway
failure returns the original deterministic order and records
`status: "fallback"` plus a stable reason in `retrievalTrace`. Set
`rerank: false` on one recall to skip it. An explicit `adapters.reranker` remains
authoritative over `providers.reranking`. Provider-backed reranking defaults to
a 15-second request timeout; set the optional positive-integer
`requestTimeoutMs` in `providers.reranking` when the chosen gateway needs a
different latency budget.

The trace includes bounded channel/RRF attribution, model role, sanitized
gateway, latency, scores, and before/after ranks. It does not include API keys,
query text, or memory content. This is opt-in and adds one model call per fact in
the bounded rerank window; the provider-free recommended path remains unchanged.

### Optional local embedding endpoint (Ollama)

The recommended preset works without embeddings. To add a zero-egress neural
dense channel, `GOODMEMORY_EMBEDDING_BASE_URL` accepts any OpenAI-compatible
`/v1/embeddings` endpoint, including a local Ollama server.

```bash
ollama pull nomic-embed-text        # or bge-m3 for stronger multilingual recall

export GOODMEMORY_EMBEDDING_PROVIDER=openai
export GOODMEMORY_EMBEDDING_BASE_URL=http://localhost:11434/v1
export GOODMEMORY_EMBEDDING_MODEL=nomic-embed-text
export GOODMEMORY_EMBEDDING_API_KEY=ollama   # any placeholder; Ollama ignores it, the variable stays required

# smoke-check the endpoint before starting your app
curl http://localhost:11434/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model": "nomic-embed-text", "input": "hello"}'
```

- `provider` stays `openai`: it selects the OpenAI-compatible wire protocol,
  not the vendor.
- Keep one embedding model per store: vectors from different models or
  dimensions are not comparable, and switching models means re-remembering
  (re-embedding) the corpus.
- Local embedding quality differs from `text-embedding-3-small`; the public
  LoCoMo numbers were measured with the OpenAI endpoint. This recipe
  reproduces the mechanism with zero egress, not the exact number.
- This is not `createLocalEmbeddingAdapter()` (below), which is
  hashed-lexical, not semantic, and is rejected by the recommended preset.

### Opt-in multi-hop recall

`recall()` is single-pass by default. Pass `multiHop: true` for an opt-in
two-pass retrieval: GoodMemory runs the query, extracts bridge entities named in
the first-pass evidence, expands the query with them, and runs a second pass.

```ts
const recall = await memory.recall({
  scope,
  query: "Who manages the project Alice started?",
  multiHop: true,
});
```

Use it when the answer needs an entity that only the first hop names (hop 1 finds
"Alice started Project Atlas"; hop 2 needs "who manages Project Atlas").

- It is opt-in. Default recall stays single-pass; leaving `multiHop` unset
  changes nothing.
- It is **not** a general semantic retriever. It bridges named entities
  lexically; it does not rank by meaning.
- It can **add noise when first-pass recall is weak**: if hop 1 surfaces the
  wrong evidence, the extracted bridge entities are wrong and the expanded query
  dilutes recall. Measured on LoCoMo (where base retrieval is very low) `multiHop`
  *hurt* recall, so do not reach for it to fix conversational / phrasing-gap
  retrieval — that needs real semantic retrieval, not multi-hop bridging.

### Offline local embedding adapter

`createLocalEmbeddingAdapter()` is a deterministic, offline, dependency-free
embedding adapter (hashed character-n-gram vectors). Inject it for
lexical/morphological tie-breaking without configuring an embedding provider:

```ts
import { createGoodMemory, createLocalEmbeddingAdapter } from "goodmemory";

const memory = createGoodMemory({
  adapters: { embeddingAdapter: createLocalEmbeddingAdapter() },
});
```

- It is **not** neural semantic retrieval. The vectors are hashed lexical
  features, so they break ties between lexically similar candidates; they do not
  understand meaning.
- Do **not** use it to claim a semantic benchmark improvement. It cannot bridge a
  question-to-text phrasing gap that surface lexical overlap already misses.
- For real semantic ranking, configure a neural embedding provider via
  `GOODMEMORY_EMBEDDING_*` instead.

### Opt-in conversational fact extraction

By default, assisted extraction (when a `providers.extraction` model is
configured) pulls durable product memory — profiles, preferences, references,
and facts. Set `providers.extraction.mode: "conversational"` to instead
decompose dialogue into self-contained, coreference-resolved, entity- and
date-normalized atomic claims at write time, so later retrieval matches a
normalized fact instead of a raw conversational turn.

```ts
const memory = createGoodMemory({
  providers: {
    extraction: {
      provider: "openai",
      model: "gpt-5.6-terra",
      apiKey: process.env.GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY!,
      baseURL: process.env.GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL,
      mode: "conversational",
    },
  },
});
```

Use it for chat/agent products where memory comes from multi-turn conversation
and questions are phrased differently from how things were said ("Who is the
user's manager?" vs. "yeah my boss Dana signed off").

- It is opt-in. Leaving `mode` unset (or omitting `providers.extraction`) keeps
  the default extraction behavior; the recall ranking path is untouched.
- It is a **write-time LLM pass**: it uses your configured chat model, so it adds
  extraction latency and token cost, and like any LLM step it can drop or
  misphrase a claim. Raw turns remain the ground truth.
- It is **not** semantic retrieval. It normalizes the stored text so lexical
  retrieval has a better surface to match; it does not rank by meaning. It is the
  embedding-free lever for the conversational phrasing gap, not a replacement for
  a neural embedding provider.
- Do **not** quote a benchmark number from it without held-out validation, and
  do not tune the extraction prompt to a specific benchmark's phrasing.

## Runtime And Storage

`createGoodMemory({})` follows a local-first auto-storage contract:

- Explicit `storage.provider` wins when supplied.
- Without explicit storage, GoodMemory uses Postgres only when a configured
  target can bootstrap the GoodMemory backend.
- On Bun, zero-config durable storage is local SQLite at
  `./.goodmemory/memory.sqlite`.
- On Node runtimes without the built-in local SQLite adapter, zero-config
  storage falls back to in-memory.
- Unsupported explicit built-in `sqlite` or `postgres` selections are reported
  as unavailable rather than mislabeled durable.
- Injected `documentStore`, `sessionStore`, or `vectorStore` adapters are
  reported as adapter-defined storage.
- Without a retrieval preset, runtime behavior remains `rules-only` regardless
  of embedding configuration. The `recommended` preset routes `auto` to its
  provider-free hybrid fusion path and adds dense evidence when configured.
- Supported local runtimes can use `sqlite-vss` for SQLite semantic indexing;
  unsupported runtimes keep durable non-accelerated fallback behavior.

Inspect the resolved runtime instead of guessing:

```ts
import { createGoodMemory, inspectGoodMemoryRuntime } from "goodmemory";

const memory = createGoodMemory({});
const runtime = inspectGoodMemoryRuntime(memory);

console.log(runtime.storage);
```

SQLite vector controls:

- `GOODMEMORY_SQLITE_VECTOR_MODE=off|prefer|require`
- `GOODMEMORY_SQLITE_CUSTOM_LIBRARY_PATH`
- `GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH`
- `GOODMEMORY_SQLITE_VECTOR_EXTENSION_ENTRYPOINT`
- `GOODMEMORY_SQLITE_VECTOR_SEARCH_FUNCTION`

## Public Remember Customization

Product integrations should customize writes through the public `remember`
surface. Do not use test-only extractor seams for product behavior.

```ts
import { createGoodMemory, rememberRules } from "goodmemory";

const memory = createGoodMemory({
  remember: {
    preset: "default",
    profiles: [
      {
        id: "life-coach",
        when: { agentId: "life-coach" },
        rules: [
          rememberRules.fact(/my top priority this quarter is (.+)/i, {
            id: "life-goal-priority",
            category: "goal",
            tags: ["life_coach", "long_term_goal"],
            attributes: { horizon: "quarter" },
            content: ({ match }) => match[1] ?? "",
          }),
          rememberRules.preference(/please coach me with (.+)/i, {
            id: "life-coaching-style",
            category: "coaching_style",
            value: ({ match }) => match[1] ?? "",
          }),
        ],
        assistantOutputs: { mode: "confirmed_or_verified_only" },
      },
    ],
  },
});

await memory.remember({
  scope: { userId: "u-1", agentId: "life-coach" },
  messages: [
    {
      role: "user",
      content: "My top priority this quarter is rebuilding my sleep routine.",
    },
  ],
  annotations: [
    {
      messageIndex: 0,
      remember: "always",
      metadataPatch: { tags: ["confirmed_by_host"] },
    },
  ],
});
```

Profile `extractors` can be raw `MemoryExtractor` objects or named
`{ id, extractor }` entries. Use named extractors for real integrations so
remember events and eval reports carry stable `extractorIds` even if profile
composition changes. Remember events also carry resolved `profileId` and
`presetId` metadata.

## AI SDK Adapter

GoodMemory's Node-compatible AI SDK path is a plain `Request -> Response`
server handler built from `createGoodMemory()` and `createGoodMemoryAISDK()`.

```ts
import { createGoodMemory } from "goodmemory";
import type { GoodMemoryStreamTextInput } from "goodmemory/ai-sdk";
import { createGoodMemoryAISDK } from "goodmemory/ai-sdk";

const memory = createGoodMemory({});

const aiSDK = createGoodMemoryAISDK({
  memory,
});

type MemoryChatRequest = Pick<
  GoodMemoryStreamTextInput,
  "messages" | "query" | "scope" | "system"
>;

function isMemoryChatRequest(value: unknown): value is MemoryChatRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const scope = candidate.scope;
  return Array.isArray(candidate.messages)
    && !!scope
    && typeof scope === "object"
    && !Array.isArray(scope)
    && typeof (scope as { userId?: unknown }).userId === "string"
    && (scope as { userId: string }).userId.trim().length > 0;
}

export async function handleMemoryChat(request: Request): Promise<Response> {
  const body: unknown = await request.json();
  if (!isMemoryChatRequest(body)) {
    return new Response(
      JSON.stringify({
        error: "Expected a request body with a messages array and scope.userId.",
      }),
      {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 400,
      },
    );
  }

  const result = aiSDK.streamText({
    messages: body.messages,
    query: body.query,
    scope: body.scope,
    system: body.system,
    model: {} as never,
  });

  return result.toTextStreamResponse();
}
```

Notes:

- The canonical server example is
  [examples/plain-ai-sdk-server.ts](./examples/plain-ai-sdk-server.ts).
- Thin Express and Fastify examples are
  [examples/express-chat-server.ts](./examples/express-chat-server.ts) and
  [examples/fastify-chat-server.ts](./examples/fastify-chat-server.ts).
- `examples/vercel-ai-chat.ts` remains a lower-level wrapper/API example.
- Next.js App Router can map `export async function POST(request: Request)`
  to the same handler body.
- The first public server path is `ModelMessage`-first.
- The wrapper augments `system` through `recall()` and `buildContext()` and
  soft-fails if the memory layer errors.

## Python/FastAPI HTTP Bridge

Use the packaged HTTP bridge when a Python backend should call GoodMemory as a
server-side memory service.

```bash
GOODMEMORY_HTTP_BRIDGE_TOKEN="replace-with-service-token" \
GOODMEMORY_STORAGE_PROVIDER=postgres \
GOODMEMORY_STORAGE_URL="postgres://user:pass@host:5432/goodmemory" \
./node_modules/.bin/goodmemory-http-bridge --profile life-coach
```

Python callers send `Authorization: Bearer <token>` plus the `x-goodmemory-*`
scope headers to `POST /memory/recall-context`, `/memory/remember`,
`/memory/feedback`, `/memory/export`, `/memory/forget`, and targeted
`/memory/revise`. The TypeScript bridge API is available from `goodmemory/http`.

To serve the recommended retrieval preset (multi-granular BM25 + entity + RRF,
with an optional dense channel)
over the bridge, start it with the one switch `--recommended` (or
`GOODMEMORY_PROFILE=agent-recommended` or
`GOODMEMORY_HTTP_BRIDGE_RECOMMENDED=1`). No embedding endpoint is required;
`GOODMEMORY_EMBEDDING_*` adds the dense channel when configured. `GET /healthz`
reports `retrievalTier` and `embeddingEnabled`, and recall requests default to
`strategy: "auto"`, which the preset routes to `hybrid`. An explicit
`strategy: "rules-only"` request still selects the strict floor.

Or deploy it with Docker in one command (SQLite volume included; add the
compose `postgres` profile for pgvector):

```bash
GOODMEMORY_HTTP_BRIDGE_TOKEN="replace-with-service-token" docker compose up -d
curl -fsS http://127.0.0.1:8739/healthz
```

`GET /healthz` is the auth-free liveness endpoint for containers, load
balancers, and client ready-waits. Python backends should use the official
client — `pip install goodmemory-client` ([PyPI](https://pypi.org/project/goodmemory-client/)) —
which derives the caller headers from one `Scope` object, mirrors the
per-endpoint idempotency rules, and surfaces recall `routing` (so silent
strategy downgrades are visible). Details:
[docs/GoodMemory-Python-HTTP-Integration-Bridge.md](./docs/GoodMemory-Python-HTTP-Integration-Bridge.md).

**Hosted instance.** A live GoodMemory bridge runs at
`https://goodmemory.vibenest.net` (liveness:
[`/healthz`](https://goodmemory.vibenest.net/healthz)). Point any client at it
via `GOODMEMORY_BRIDGE_HOST` / `--goodmemory-host` (or the `GoodMemoryClient`
host argument) instead of a local URL; it enforces bearer-token auth, so bring
your own service token. It is a single-process, write-capable API — before
exposing one publicly, add rate limiting and disposable-scope data, and never
publish a shared write token.

## Host Adapter API

Use `goodmemory/host` when an external host wants artifacts or host-specific
contracts without importing internals.

```ts
import { createGoodMemory } from "goodmemory";
import { createHostAdapter } from "goodmemory/host";

const memory = createGoodMemory({});

const adapter = createHostAdapter({
  id: "codex-handoff",
  hostKind: "codex",
  memory,
  readableArtifactTypes: ["session_memory"],
});

const result = await adapter.readArtifacts({
  scope: {
    userId: "u-1",
    workspaceId: "workspace-a",
    sessionId: "s-1",
  },
  includeRuntime: true,
});
```

Modes:

- `file-assisted`: read compiled artifacts such as `MEMORY.md`, `user.md`,
  `session-memory/<sessionId>.md`, and `playbooks/*.md` without treating files
  as canonical storage.
- `file-authoritative`: available for the minimal writable subset. Today that
  subset is the canonical `playbooks/*.md` file shape, writing structured
  deltas back into active validated-pattern feedback records.

Writable guardrails:

- Prompt and skill snippet files remain derived read-only outputs.
- Risky guidance edits require explicit `verifyWrite` approval.
- Low-risk metadata edits such as `appliesTo` and `Why` can write back without
  the extra approval step.
- Failed writable operations return diagnostics with rollback guidance.

Current Claude/Codex examples stay in `file-assisted` mode by default.

## CLI Reference

The `goodmemory` command on your shell `PATH` is the global CLI installed with
`npm install -g goodmemory@0.5.1`. In a local dependency install, invoke the
package bin as `npx goodmemory`, `npm exec -- goodmemory`, or
`./node_modules/.bin/goodmemory`. The repo-local `bun run goodmemory` script is
for development only.

Memory-first commands:

```bash
./node_modules/.bin/goodmemory inspect --user-id <user-id> --workspace-id <workspace-id>
./node_modules/.bin/goodmemory trace --user-id <user-id> --workspace-id <workspace-id> --query "Which runbook is the source of truth?"
./node_modules/.bin/goodmemory export-memory --user-id <user-id> --workspace-id <workspace-id> --output ./tmp/export
./node_modules/.bin/goodmemory stats --user-id <user-id> --workspace-id <workspace-id>
./node_modules/.bin/goodmemory remember --user-id <user-id> --workspace-id <workspace-id> --session-id <session-id> --message "Remember that the deploy is blocked on smoke verification."
./node_modules/.bin/goodmemory feedback --host codex --workspace-root . --session-id <session-id> --signal "Keep coding summaries short and list explicit next steps."
./node_modules/.bin/goodmemory forget --host codex --workspace-root . --session-id <session-id> --memory-id <memory-id>
```

Installed-host commands:

```bash
goodmemory -V
goodmemory --version
goodmemory setup --host codex
goodmemory status codex --workspace-root .
goodmemory install codex --activation-mode global --writeback observe --user-id <user-id>
goodmemory enable codex --workspace-root . --writeback selective
goodmemory mcp serve --host codex
goodmemory-mcp --host codex
goodmemory codex bootstrap --user-id <user-id> --workspace-id <workspace-id>
goodmemory claude bootstrap --user-id <user-id> --workspace-id <workspace-id>
```

Hook and writeback examples:

```bash
printf '%s' '{"cwd":".","session_id":"s-1","hook_event_name":"SessionStart","source":"startup"}' \
  | goodmemory codex hook session-start

printf '%s' '{"cwd":".","session_id":"s-1","tool_name":"Bash","tool_input":{"command":"./tools/DeepAnalyzer --detailed"}}' \
  | goodmemory codex hook pre-tool-use

goodmemory codex action -- ./tools/DeepAnalyzer --detailed

printf '%s' '{"cwd":".","session_id":"s-1","messages":[{"role":"user","content":"Next step is to finish the release smoke."}]}' \
  | goodmemory codex writeback --json

printf '%s' '{"cwd":".","session_id":"s-1","event_id":"stop-1","summary":"Keep coding summaries short."}' \
  | goodmemory codex hook session-stop
```

Eval artifact inspection:

```bash
./node_modules/.bin/goodmemory eval inspect --run-dir reports/eval/live/<run-id> --case-id <case-id>
./node_modules/.bin/goodmemory eval trace --run-dir reports/eval/live/<run-id> --case-id <case-id>
./node_modules/.bin/goodmemory eval export-case --run-dir reports/eval/live/<run-id> --case-id <case-id> --output /tmp/case.json
```

CLI surface:

- `goodmemory -V`
- `goodmemory --version`
- `goodmemory setup`
- `goodmemory status`
- `goodmemory install`
- `goodmemory uninstall`
- `goodmemory enable`
- `goodmemory disable`
- `goodmemory inspect`
- `goodmemory trace`
- `goodmemory export-memory`
- `goodmemory stats`
- `goodmemory remember`
- `goodmemory feedback`
- `goodmemory forget`
- `goodmemory mcp serve`
- `goodmemory-mcp`
- `goodmemory codex hook`
- `goodmemory codex writeback`
- `goodmemory claude hook`
- `goodmemory claude writeback`
- `goodmemory codex bootstrap`
- `goodmemory claude bootstrap`
- `goodmemory eval inspect`
- `goodmemory eval trace`
- `goodmemory eval export-case`

## Examples

Installed-package guides:

- 15-minute app integration guide:
  [docs/GoodMemory-15-Minute-App-Integration.md](./docs/GoodMemory-15-Minute-App-Integration.md)
- Reference integration guide:
  [docs/GoodMemory-Reference-Integration-Guide.md](./docs/GoodMemory-Reference-Integration-Guide.md)
- Codex handoff setup guide:
  [docs/GoodMemory-Codex-Handoff-Setup-Guide.md](./docs/GoodMemory-Codex-Handoff-Setup-Guide.md)
- Claude Code setup guide:
  [docs/GoodMemory-Claude-Code-Setup-Guide.md](./docs/GoodMemory-Claude-Code-Setup-Guide.md)

Repo-local examples:

- Basic chat integration: [examples/basic-chat.ts](./examples/basic-chat.ts)
- Coding-agent flavored integration:
  [examples/coding-agent.ts](./examples/coding-agent.ts)
- Plain AI SDK server integration:
  [examples/plain-ai-sdk-server.ts](./examples/plain-ai-sdk-server.ts)
- Express chat server integration:
  [examples/express-chat-server.ts](./examples/express-chat-server.ts)
- Fastify chat server integration:
  [examples/fastify-chat-server.ts](./examples/fastify-chat-server.ts)
- AI SDK wrapper integration:
  [examples/vercel-ai-chat.ts](./examples/vercel-ai-chat.ts)
- Life-coach public remember profile:
  [examples/life-coach-remember-profile.ts](./examples/life-coach-remember-profile.ts)
- Claude-style host artifact consumption:
  [examples/host-claude-artifacts.ts](./examples/host-claude-artifacts.ts)
- Codex-style session handoff consumption:
  [examples/host-codex-handoff.ts](./examples/host-codex-handoff.ts)

Run examples from this repo:

```bash
bun run example:chat
bun run example:coding-agent
bun run example:ai-sdk-server
bun run example:express-chat
bun run example:fastify-chat
bun run example:vercel-ai
bun run example:life-coach-profile
bun run example:host-claude
bun run example:host-codex
```

## Testing And Eval

Default local gates:

```bash
bun test
bun run typecheck
bun run test:coverage
```

Use `bun run test:all` only when you intentionally want the broader sweep
through vendored or third-party test trees.

Eval commands:

```bash
bun run eval:smoke
bun run eval:fallback
bun run eval:live
bun run eval:live-memory
bun run eval:live-auto-memory
bun run eval:live-provider-memory
bun run eval:summary
```

Meanings:

- `eval:smoke`: harness self-check.
- `eval:fallback`: deterministic validation without live model calls.
- `eval:live`: live generator plus live judge with an in-memory backend.
- `eval:live-memory`: live generator plus live judge using auto-storage
  semantics; default storage is local SQLite unless provider storage resolves.
- `eval:live-auto-memory`: alias for `eval:live-memory` when scripts need to
  make auto-storage explicit.
- `eval:live-provider-memory`: provider-backed evidence path requiring
  Postgres, embeddings, and assisted extraction; it does not silently fall back
  to SQLite.
- `eval:summary`: summarize existing eval output directories.

Live eval environment:

- `GOODMEMORY_EVAL_PROVIDER`
- `GOODMEMORY_EVAL_BASE_URL` for OpenAI-compatible gateways
- `GOODMEMORY_EVAL_MODEL`
- `GOODMEMORY_EVAL_API_KEY`
- `GOODMEMORY_EVAL_MAX_CONCURRENCY` optional parallelism cap
- `GOODMEMORY_JUDGE_PROVIDER`
- `GOODMEMORY_JUDGE_BASE_URL` for OpenAI-compatible gateways
- `GOODMEMORY_JUDGE_MODEL`
- `GOODMEMORY_JUDGE_API_KEY`

`eval:live-memory` and `eval:live-auto-memory` also need embedding and
assisted extractor configuration:

- `GOODMEMORY_EMBEDDING_PROVIDER`
- `GOODMEMORY_EMBEDDING_BASE_URL` for OpenAI-compatible gateways
- `GOODMEMORY_EMBEDDING_MODEL`
- `GOODMEMORY_EMBEDDING_API_KEY`
- `GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER`
- `GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL` for OpenAI-compatible gateways
- `GOODMEMORY_ASSISTED_EXTRACTOR_MODEL`
- `GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY`

`eval:live-provider-memory` additionally requires:

- `GOODMEMORY_TEST_POSTGRES_URL`

Output directories:

- live runs: `reports/eval/live/run-*`
- auto-storage live memory runs: `reports/eval/live-memory/run-*`
- provider-backed live memory runs: `reports/eval/live-provider-memory/run-*`
- fallback runs: `reports/eval/fallback/run-*`

## Strategy Rollout

GoodMemory keeps `rules-only` as the supported baseline. New retrieval behavior
moves through `observe -> assist -> promote`.

Operator guidance:

- `observe`: collect isolated shadow evidence without changing the executed path.
- `assist`: allow candidate execution in controlled eval runs.
- `promote`: require `strategy-promotion-gate.json`, a clean
  `regression-dashboard.json`, and
  `strategy-promotion-authorization.json`.
- Stay `rules-only` when eval evidence is incomplete, provider-backed
  dependencies are unavailable, or rollback conditions are present.

## Current Status

Current stable public surface:

- root memory API through `goodmemory`
- AI SDK adapter through `goodmemory/ai-sdk`
- host adapter and host contracts through `goodmemory/host`
- HTTP bridge API through `goodmemory/http` and packaged
  `goodmemory-http-bridge`
- installed CLI and managed host setup through `goodmemory setup`
- Codex and Claude Code hooks for recall
- read-only MCP for inspection and debugging
- opt-in installed-host writeback with audit and undo
- local SQLite durable fallback on Bun
- Postgres, embeddings, assisted extraction, and provider-backed evals when
  configured

Still outside the accepted public claim:

- default-on automatic writeback
- raw transcript archive
- dashboard or managed cloud
- treating exported artifact files as canonical storage
- broadening root exports with internal proposal or promotion internals

For the detailed current-state and evidence map, use
[docs/GoodMemory-Current-Status-and-Evidence.md](./docs/GoodMemory-Current-Status-and-Evidence.md).

## Documentation

- Documentation map and archive policy:
  [docs/README.md](./docs/README.md)
- Current status and evidence:
  [docs/GoodMemory-Current-Status-and-Evidence.md](./docs/GoodMemory-Current-Status-and-Evidence.md)
- Product comparison:
  [docs/GoodMemory-Product-Comparison.md](./docs/GoodMemory-Product-Comparison.md)
- Canonical design:
  [docs/GoodMemory-First-Principles-and-Reference-Architecture.md](./docs/GoodMemory-First-Principles-and-Reference-Architecture.md)
- v1 implementation architecture:
  [docs/GoodMemory-OSS-Architecture-v1.md](./docs/GoodMemory-OSS-Architecture-v1.md)
- PRD:
  [docs/GoodMemory-PRD.md](./docs/GoodMemory-PRD.md)
- TDD and evaluation strategy:
  [docs/GoodMemory-TDD-and-Evaluation-Strategy.md](./docs/GoodMemory-TDD-and-Evaluation-Strategy.md)
- Strategy rollout guide:
  [docs/GoodMemory-Strategy-Rollout-Guide.md](./docs/GoodMemory-Strategy-Rollout-Guide.md)
- Release checklist:
  [docs/GoodMemory-v1-Release-Checklist.md](./docs/GoodMemory-v1-Release-Checklist.md)
- Historical quality-gate archive:
  [docs/archive/quality-gates/README.md](./docs/archive/quality-gates/README.md)
- Historical v1 snapshot:
  [docs/GoodMemory-v1-Quality-Gate.md](./docs/GoodMemory-v1-Quality-Gate.md)
- Framework cookbooks — durable memory in an agent framework:
  [LangGraph](./docs/cookbooks/langgraph.md) ·
  [CrewAI](./docs/cookbooks/crewai.md) ·
  [OpenAI Agents SDK](./docs/cookbooks/openai-agents-sdk.md)

Use [task-board/00-README.txt](./task-board/00-README.txt) for execution order,
open follow-up work, and phase-specific acceptance boundaries. Archived design
inputs are not current truth and are routed through `docs/README.md`.
