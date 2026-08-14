# GoodMemory: First Principles and Reference Architecture

> GoodMemory is a user-aware context engine for LLM applications.
> It sits between the model and the user, not above them as an agent framework and not below them as a storage engine.

**Status:** Canonical design document  
**Audience:** OSS integrators, AI product engineers, agent runtime authors  
**Companion Document:** [GoodMemory-OSS-Architecture-v1.md](./GoodMemory-OSS-Architecture-v1.md)

---

## 1. What Problem This Solves

LLM products are stateless by default.

Every request starts from scratch unless the application decides what to carry forward from prior interactions. That means continuity is not a model capability. It is an application design problem.

A good memory layer exists to solve one concrete problem:

> How should an AI application decide what about the user and prior interactions should still matter now?

This is why GoodMemory should exist as an independent layer.

It gives any chatbox, copilot, or AI agent a consistent answer to five practical questions:

- What is worth remembering from this interaction?
- What remembered information matters for this turn?
- How should that information be rendered for the model?
- Which recalled memories are stale enough that they should be verified?
- How should old memories be merged, decayed, corrected, or removed over time?

From this perspective, GoodMemory is not primarily a database problem.

It is a **carry-forward decision system** for user-aware context.

### Why this layer is independent

It should not be buried inside:

- one model vendor's proprietary memory feature
- one agent framework's storage abstraction
- one chat product's internal session system

If memory is embedded too deeply into any one stack, users lose:

- portability
- visibility
- control
- auditability
- reusability across products

### Why it is not the same as adjacent categories

GoodMemory is not:

- **RAG**
  RAG answers "what external knowledge should I fetch?"
  Memory answers "what should still be true or relevant about this user and our relationship?"
- **Profile Store**
  A profile store keeps stable attributes.
  Memory must also handle episodic history, feedback, temporary work state, and maintenance.
- **Chat History**
  Chat history is a raw log.
  Memory is a selective, evolving representation derived from history.
- **Agent Framework**
  An agent framework decides execution flow.
  A memory layer decides continuity and context carry-forward.

---

## 2. First Principles

A good LLM-user memory layer should be designed from first principles, not by copying any one existing system.

### P1. The model is stateless; continuity is the product's responsibility

A memory layer should assume the base model remembers nothing outside the current request.

Its job is not to imitate human memory metaphorically.
Its job is to provide the **minimum useful continuity** between one request and the next.

### P2. Memory is selective carry-forward, not storage maximization

The central problem is not "how much can be stored?"

The real problem is:

- what survives
- what gets ignored
- what gets updated
- what gets recalled
- what gets rendered into the prompt

Good memory systems are judged by selectivity, not volume.

### P3. Future usefulness matters more than past completeness

A memory record should be justified by future value.

The question is not whether something happened.
The question is whether future turns benefit from carrying it forward.

This implies default conservatism:

- write less
- write higher quality
- merge aggressively
- reject noise early

### P4. Default integration must be easier than building memory badly

If `npm install goodmemory` still forces every integrator to design:

- a memory taxonomy
- a retrieval policy
- a write policy
- a prompt assembly strategy
- a maintenance loop

then the library has failed its core adoption goal.

The default path must be:

- small API surface
- sensible defaults
- local-first development mode
- no mandatory sidecar
- no mandatory queue
- no mandatory graph infrastructure

### P5. Write conservatively, recall precisely

A weak memory layer stores too much and retrieves too much.

A strong memory layer:

- stores selectively
- recalls narrowly
- compresses before injection
- keeps the model focused on what matters now

### P6. Runtime memory and durable memory must be separated

Not every useful piece of state should become long-term memory.

There are at least two different classes:

- **runtime context**
  session buffer, working memory, current plan, recent tool output
- **durable memory**
  profile, preferences, episodes, feedback, references

Blending them together makes both worse:

- runtime state becomes sticky and stale
- durable memory becomes noisy and bloated

### P7. Procedural memory is first-class

Many systems model facts and episodes, but neglect "how the assistant should behave."

That is a mistake.

A high-quality memory layer must represent:

- what the user prefers
- what the user dislikes
- what approaches were explicitly corrected
- what approaches were explicitly validated

This is not just preference.
It is **procedural memory**: remembered guidance about how to act.

### P8. Verify before acting on stale memory

Memory is not truth.

A memory item is a claim that something was true, relevant, or useful at some earlier time.

If a recalled memory will drive action, the system should prefer lightweight verification when feasible.

Examples:

- a remembered file path should be checked before use
- a remembered workflow should be validated against current project state
- a remembered project status should be treated as possibly stale

### P9. Maintenance is a core responsibility, not an afterthought

Without maintenance, memory quality decays automatically.

Every real memory system needs:

- dedupe
- supersession
- query-time soft decay
- contradiction repair
- stale verification
- consolidation
- hard expiry and deletion

The only question is whether these happen explicitly and safely, or implicitly and badly.

Soft decay is recall policy: relevance and freshness affect the current query's
ranking without rewriting a memory's confidence or lifecycle. Hard TTL expiry is
maintenance: recall hides expired facts immediately, and maintenance later
persists the inactive lifecycle and removes their vectors. Retrieval exposure is
not evidence that a memory is true or useful, so merely recalling a record must
not reinforce its future rank.

### P10. Explainability and user control are mandatory

A good memory layer must be able to answer:

- Why was this remembered?
- Why was this recalled?
- Was this explicit or inferred?
- How can it be corrected or deleted?
- Can the user ask the system not to use memory here?

Without these properties, memory becomes hard to trust and hard to ship.

### P11. Context pressure management is important, but not the product's first mental model

Top-tier systems also need:

- tool-result spillover
- preview replacement
- microcompact
- session-journal compaction
- full compaction

But these are **advanced internal capabilities**, not the first thing an integrator should have to understand.

For the outside world, the first mental model should remain:

> GoodMemory helps the app remember the right things about the user and prior interactions.

### P12. Do not persist what can be authoritatively re-derived

A memory layer should avoid storing information that is better sourced elsewhere.

By default, do not persist:

- current code structure
- current file contents
- recent git history
- volatile execution state that belongs to a task system
- information already fully represented in an authoritative system

Memory should store what is **non-obvious, user-specific, or continuity-critical**.

---

## 3. What a Memory Layer Is Not

Defining boundaries is as important as defining capabilities.

### It is not a general knowledge platform

GoodMemory should not try to be the user's universal external brain for all data.

It is not:

- a document ingestion platform
- a universal enterprise search system
- a global knowledge graph product

Those can integrate with it.
They should not define it.

### It is not orchestration

GoodMemory should not own:

- tool selection
- agent planning
- workflow scheduling
- multi-agent execution graphs

It can inform those decisions.
It should not become responsible for them.

### It is not a full memory OS by default

The "memory OS" vision is powerful, but it comes with much higher complexity:

- heavier infrastructure
- broader governance scope
- more operational surfaces
- more product surface area than most integrators need

GoodMemory should learn from memory OS designs, not become one by default.

### It is not multimodal-first by default

Multimodal memory, graph memory, tool memory, and document memory are all valid future directions.

But they should not be required to understand or adopt GoodMemory v1.

Default v1 should stay focused on:

- text interactions
- user continuity
- cross-session memory
- runtime context quality

### It is not a black-box personalization feature

A memory layer should never be presented as magic personalization.

It should remain:

- inspectable
- editable
- policy-constrained
- optionally disableable

---

## 4. The Irreducible Responsibilities

A good memory layer can expose many APIs internally, but its irreducible job can be reduced to five responsibilities.

### 4.1 `remember`: decide what is worth persisting

This responsibility answers:

- Was there anything in the latest interaction worth carrying forward?
- If yes, what type of memory is it?
- Is it explicit, inferred, confirmed, or stale?
- Should it merge into existing memory, supersede it, or be rejected?

This is not raw logging.
It is memory compilation.

### 4.2 `recall`: decide what matters now

This responsibility answers:

- Which memory categories matter for this turn?
- How much of each category should be searched?
- Should runtime state be preferred over long-term memory?
- Which retrieved items are actually useful enough to include?

This is not generic retrieval.
It is context selection under uncertainty and budget constraints.

### 4.3 `buildContext`: render memory into model-usable form

A memory system is only valuable if it can translate memory into usable model context.

This responsibility includes:

- summarization
- ranking
- token budgeting
- section allocation
- output shaping for different runtimes

The model does not consume memory objects.
It consumes prompts, messages, and attachments.

### 4.4 `verify`: avoid acting on stale memory

This responsibility exists because memory can drift.

It determines:

- when recalled memory is safe to trust as-is
- when it should be lightly verified
- when it should be down-weighted
- when it should be corrected or invalidated

This is one of the clearest differences between a good memory layer and a naive one.

### 4.5 `maintain`: decay, consolidate, repair

The memory layer must maintain quality over time.

That includes:

- dedupe cleanup
- contradiction repair
- decay
- consolidation
- re-indexing
- stale memory correction
- delete/export pipelines

This does not need to be in the hot path.
It must still exist.

### The minimal closed loop

From first principles, GoodMemory is not a memory store.

It is the smallest closed loop of:

> **write -> recall -> compose -> verify -> maintain**

If any one of those is absent, the system stops being a strong memory layer and becomes a partial utility.

---

## 5. Memory Taxonomy

GoodMemory should expose a stable conceptual taxonomy even if its internal implementation evolves.

### 5.1 Runtime memory

Runtime memory exists to support continuity within and around the current working session.

Typical contents:

- session buffer
- working memory snapshot
- session journal
- optional runtime context controls

Characteristics:

- short-lived
- high update frequency
- high action relevance
- usually not exported as durable user memory

### 5.2 Semantic memory

Semantic memory is stable, structured, reusable knowledge about the user and the working relationship.

Typical contents:

- user profile
- preferences
- facts
- references to external systems

Characteristics:

- slower-changing
- easy to re-use across sessions
- usually cheap to inject
- should support clear provenance and update semantics

### 5.3 Episodic memory

Episodic memory records what happened, what was decided, and what remained unresolved.

Typical contents:

- episodes
- key decisions
- unresolved items
- follow-up hooks

Characteristics:

- narrative and temporal
- useful for "last time", "continue", "earlier we discussed"
- better suited to summarization and semantic recall than exact lookup

### 5.4 Procedural memory

Procedural memory captures how the system should behave.

Typical contents:

- user corrections
- confirmed working approaches
- validated patterns
- "do this", "don't do this", "prefer this" guidance

Characteristics:

- highly behavior-shaping
- often more important than facts for quality of collaboration
- should not be collapsed into ordinary preference or fact memory

### 5.5 Derived memory

Derived memory contains higher-order inferences that may be useful but should be treated cautiously.

Typical contents:

- inferred goals
- habits
- risk patterns
- higher-level insights

Characteristics:

- lower default trust
- should carry confidence and evidence
- should be optional in v1

### Why this taxonomy matters

Different memory types should not share:

- identical write criteria
- identical recall strategy
- identical rendering strategy
- identical lifecycle policy

The taxonomy is useful precisely because the system should behave differently for each class.

---

## 6. Reference Architecture

This section describes the reference shape of GoodMemory as an OSS library.

### 6.1 Public API: keep it minimal

GoodMemory should present a small, obvious public interface:

```ts
import { createGoodMemory } from "goodmemory";

const gm = createGoodMemory({
  storage: { provider: "sqlite", url: "./goodmemory.db" },
  embedding: { provider: "openai", model: "text-embedding-3-small" },
  llm: { provider: "anthropic", model: "claude-sonnet" },
});

const recall = await gm.recall({
  scope: { userId: "u_123", sessionId: "s_001" },
  query: userMessage,
  retrievalProfile: "general_chat",
});

const memoryContext = await gm.buildContext({
  recall,
  output: "system_prompt_fragment",
});

await gm.remember({
  scope: { userId: "u_123", sessionId: "s_001" },
  messages: conversation,
});

await gm.feedback({
  scope: { userId: "u_123" },
  signal: "The user explicitly confirmed that concise, code-heavy answers are preferred.",
});
```

This is the product-level contract.

Note:
The snippet above describes the intended reference architecture contract, not necessarily the exact current v1 runtime surface.
In the current implementation, `storage` is the only required runtime config.
`llm` and `embedding` remain first-class planning concepts because the product is expected to grow into hybrid retrieval, provider-backed judge/eval, and optional learned routing.

Integrators should not need to understand internal subsystems before they can use the library correctly.

### 6.2 The public API should mean exactly this

- `createGoodMemory(config)`
  initialize the memory layer with defaults
- `recall(input)`
  select relevant memory for this turn
- `buildContext(input)`
  render recalled memory into model-usable form
- `remember(input)`
  compile new durable memory from recent interaction
- `forget(input)`
  remove or invalidate a memory item
- `feedback(input)`
  explicitly update procedural memory

Advanced APIs such as `updateWorkingMemory()` or `runMaintenance()` may exist.
They should not define the main adoption story.

### 6.3 Internal architecture: four engines

Internally, GoodMemory should be thought of as four cooperating engines.

#### 1. Runtime Context Engine

Owns:

- session buffer
- working memory
- session journal
- optional runtime context controls

Purpose:

- preserve immediate continuity
- support long sessions
- reduce unnecessary long-term writes

#### 2. Durable Memory Engine

Owns:

- semantic memory
- episodic memory
- procedural memory
- derived memory

Purpose:

- represent what should persist across sessions
- support provenance, updates, and deletion

#### 3. Retrieval and Context Builder Engine

Owns:

- routing
- memory selection
- reranking
- summarization
- token budgeting
- output shaping

Provider-backed reranking is an optional order-only stage after deterministic
admission. It scores one query-document pair per call, cannot add or remove
memory membership, and cannot override grounded abstention. Failures return the
pre-rerank result; bounded channel/fusion/reranker attribution is exposed through
a redaction-safe retrieval trace.

Purpose:

- turn memory into useful model context without overwhelming the prompt

#### 4. Maintenance Engine

Owns:

- extraction workers
- dedupe
- decay
- consolidation
- contradiction repair
- stale verification
- dream-style maintenance

Purpose:

- keep the system healthy over time without bloating the hot path

### 6.3.1 Repository invariants: core contracts, core behavior, adapters, composition

The repository should preserve four explicit implementation zones:

- **core contracts/model**
  `domain/` plus stable contract files such as evidence, evolution, embedding, and storage contracts
- **core behavior**
  `remember/`, `recall/`, `runtime/`, `maintenance/`, `verify/`, `governance/`, and non-contract evolution flows
- **adapters**
  provider-backed, vendor-backed, storage implementation, and future host/file-authoritative integrations
- **composition**
  public API wiring, CLI wiring, and package export surfaces

These are repository invariants, not style preferences.

Implications:

- core contracts do not depend on API, eval, provider, vendor runtime, or concrete storage implementations
- core behavior does not depend on API, eval, CLI, provider/vendor runtime, or concrete storage implementations
- core behavior depends on narrow internal subsystem ports rather than the wide repository assembly surface
- provider-backed and host/file-authoritative behavior enter only through explicit adapter boundaries and do not redefine the core truth model
- `createGoodMemory(config)` is the public factory/facade and `api/goodMemoryAssembly.ts` is the only concrete implementation assembly module; raw repository and engine assembly are internal-only, while the supported advanced runtime surface is `createRuntimeContextService` plus the stable `createRuntimeArchiveStore` adapter for persisting summary-only session archives without normalized transcripts
- `src/provider/` is the provider-backed implementation boundary; provider runtime code does not live in a parallel compatibility tree
- dependency-matrix tests are part of the merge gate for the post-v1 archive, evidence, proposal, and host-adapter work

### 6.3.2 LanguagePack is a vertical semantic boundary

Language support crosses the full memory lifecycle. A locale-specific label
file is insufficient because extraction, retrieval, temporal meaning, entity
identity, and rendering must agree on the same semantics. Each `LanguagePack`
therefore owns detection, equality normalization, tokenization, bounded search
terms, query/content analysis, decomposition, temporal parsing, entity
extraction and matching, candidate extraction, and rendering.

The composition root resolves one pack for each operation and passes that
identity through remember, recall, projections, storage search, provenance, and
context construction. Core modules must not add parallel locale switches or
import concrete packs directly. Locale-specific lexicons, Unicode-script
checks, and natural-language rules belong under `src/language/**`; storage
receives derived search fields and does not interpret locale.

The first-class built-ins are English, Simplified Chinese, Traditional Chinese,
Japanese, Korean, French, and Spanish. Simplified and Traditional Chinese share implementation
primitives but deliberately use distinct compatibility groups and script-local
search analyzers. The 0.7 contract guarantees same-script recall, not
Simplified/Traditional cross-script lexical equivalence. Canonical source text
is never converted, and this boundary does not introduce OpenCC, a third-party
language detector, or a Japanese/Korean/Romance-language NLP runtime. Ambiguous
Han-only or unmarked Latin text resolves through the configured default;
unsupported explicit locales use neutral Unicode behavior rather than English
semantics.

`analyzerVersion` is a migration identity, not display metadata. Derived recall
documents record pack, analyzer, locale, and search-schema identity; any
semantic analyzer change requires a version bump and fail-closed projection
rebuild. Canonical memory remains raw and immutable with respect to search
normalization. Storage indexes admit candidates over derived `searchText`, while
application-level scoring remains the cross-backend ranking authority.
The stable `LanguageService` analyzer manifest covers resolver configuration,
all active packs, and custom-detector identity. An unversioned custom detector
cannot participate in a persistent completeness proof.

The current 0.7 projection generation is versioned independently of canonical
memory: documents v4, entities v2, claims/status v2, and scope catalog v2. A
per-scope migration rebuilds from canonical sources, validates source and
derived-record coverage, then atomically publishes a complete catalog proof. Recall must not
consume a partial new generation; it uses the canonical fallback until cutover.
Migration is repeatable and does not rewrite canonical memory. This is a clean
breaking replacement of the former language adapter, with no compatibility
shim or dual-write period; see ADR-008 and the 0.6-to-0.7 migration guide.

### 6.3.3 Explicit orchestration and repository-only proof boundaries

Hot-path modules are split by ownership and side-effect order, not by line
count alone:

- API assembly owns concrete providers, storage, projections, repositories,
  engines, maintenance, and evolution; the public factory only exposes the
  supported facade.
- Remember owns immutable source-message CAS, one resolved extraction shared by
  `extract()` and `remember()`, and an explicit ordered write/rollback stage.
- Recall exchanges narrow request, loaded-content, and retrieved-candidate
  contracts across content loading, retrieval/fusion, and result assembly;
  cross-pass orchestration remains visible at the API boundary.
- The CLI root performs parse/version/error/help routing and explicit dispatch
  to memory, host, eval, or service command families. It does not use a dynamic
  command registry or middleware framework.

Proof code is not a fifth production engine. Small repository-only primitives
for canonical JSON bytes, file closure, content digests, and Git identity live
under `scripts/proof/`; production
`src/` cannot import them. Research schemas, lifecycle rules, provider/scorer
semantics, thresholds, and report layouts remain owned by each protocol. The
static research registry selects only active protocols and exact historical
gates. An active protocol runs its historical loader inside an isolated checkout
at the bound commit/tree, installs the checkout's frozen dependency lock, and
accepts only a narrow DTO from that execution; verification also runs the exact
historical gates in that checkout. The current clean execution identity is
checked before and after the protocol. Frozen artifacts retain their original
paths, bytes, and source identities.

Release preparation similarly uses an explicit fixed sequence: freeze source,
run required checks, pack once, verify the same tarball, recheck source, then
write one authoritative manifest and deterministic evidence archive. Summary
Markdown is a projection, promotion is a separate explicit action, and external
publication remains workflow-owned. See ADR-009.

This boundary does not change HTTP bridge behavior, installed-host writeback,
or benchmark-claim policy and machine-readable claim surfaces.

### 6.4 Default vs optional capabilities

The reference architecture should explicitly separate what is default from what is optional.

| Capability | Default in v1 | Notes |
|---|---|---|
| Semantic memory | Yes | Core |
| Episodic memory | Yes | Core |
| Procedural memory | Yes | Core |
| Runtime memory | Yes | Core |
| Session journal | Yes | Core |
| Background maintenance | Yes | Core, but not required in the minimal integration path |
| Runtime context controls | Optional | Advanced internal capability |
| Tool-result spillover | Optional | Primarily for tool-enabled agents |
| Multimodal memory | No | Future direction |
| Graph-native memory | No | Future direction |
| Managed service / dashboard | No | Product layer |

### 6.5 Advanced internal capability: optional runtime context controls

Top-tier systems need more than durable memory.

They often also need:

- spillover for oversized tool or retrieval results
- deterministic preview replacement
- microcompact
- session-journal compaction
- full compaction

GoodMemory should acknowledge this and leave extension points for it.

But these remain advanced internal controls.

They should not define the first impression of the project.

---

## 7. Integration Model

GoodMemory should be easy to integrate into different application shapes without becoming framework-coupled.

### 7.1 The generic integration lifecycle

There are three natural hook points:

#### Before the model call

- run `recall()`
- run `buildContext()`
- inject the resulting context into the prompt or message envelope

#### After the model response

- run `remember()`
- optionally run `feedback()` if there was explicit correction or validation

#### Outside the request path

- run optional maintenance jobs
- decay, consolidate, verify, repair

This pattern works across almost every AI application shape.

### 7.2 Chatbox integration

For a chatbox, the default integration should be:

- use `general_chat` retrieval profile
- prioritize semantic + episodic + procedural memory
- keep runtime memory light
- use `feedback()` when explicit user guidance appears

The goal here is:

- better personalization
- fewer repeated background explanations
- more coherent cross-session continuity

### 7.3 Coding agent integration

For a coding agent, the default integration should be:

- use `coding_agent` retrieval profile
- prioritize runtime memory, procedural memory, episodes, and project facts
- optionally enable runtime context controls when tool outputs are large

The goal here is:

- preserve task continuity
- remember validated approaches and user corrections
- continue long-running work without flooding the prompt

### 7.4 Workflow agent integration

For workflow or task agents, the default integration should be:

- keep runtime and durable memory separate
- use memory for durable continuity
- keep task orchestration and queue semantics outside GoodMemory

The goal here is:

- memory informs the workflow
- memory does not become the workflow engine

### 7.5 Framework integration philosophy

GoodMemory should integrate with:

- plain SDK users
- chatbox backends
- agent runtimes
- workflow systems

But it should not require any one of them.

Its integration philosophy should be:

> framework-friendly, framework-independent

---

## 8. Simplicity Strategy

If GoodMemory is difficult to adopt, it will be bypassed.

So simplicity must be designed intentionally.

### 8.1 The default story must stay small

The default user story should be:

1. install the package
2. configure storage and an embedding model
3. call `recall()` before the model
4. call `remember()` after the model

That is the minimal value path.

### 8.2 Hide complexity behind defaults and profiles

Advanced behavior should mostly live behind:

- retrieval profiles
- policy hooks
- optional adapters
- optional maintenance workers

This means:

- beginners get a good default system
- advanced users can tune behavior deeply
- the public API does not explode

### 8.3 Avoid the memory OS trap in v1

A memory OS approach tends to add:

- more infrastructure
- more abstractions
- more product surfaces
- more ways to misconfigure the system

GoodMemory should remain intentionally narrower in v1.

It should be:

- easy to embed
- easy to explain
- easy to inspect
- easy to extend

It should not require integrators to adopt a broader operating model for memory.

### 8.4 Keep advanced features available, not mandatory

GoodMemory should allow, but not require:

- sidecar services
- queues
- graph backends
- multimodal memory pipelines
- UI memory viewers
- policy management consoles

These are valid future layers.
They are not the default contract.

---

## 9. Industry Comparison

The point of comparison is not to imitate any one project.

It is to understand which ideas deserve to become part of GoodMemory and which ones should remain out of scope.

| Project | Borrow | Avoid | GoodMemory's choice |
|---|---|---|---|
| **LangMem** | Hot-path memory tools, background memory manager, explicit memory workflows | Tight conceptual gravity toward LangGraph's storage and runtime model | Borrow the dual model of hot-path plus background maintenance, but keep GoodMemory framework-neutral |
| **Mem0** | Extremely simple API, low adoption friction, memory as a developer product | Reducing memory to a flat CRUD-like abstraction without a strong internal taxonomy | Be almost as easy to adopt as Mem0, but keep a stronger memory model and maintenance layer |
| **Zep** | Temporal awareness, provenance, pre-assembled context, strong focus on production retrieval quality | Making graph-rich context engineering the default operational model for everyone | Carry forward temporal and provenance thinking, but keep graph-native memory optional rather than foundational |
| **EverMemOS** | Ambition around continuous learning, cross-session memory, richer memory experiences beyond plain chat | Heavy platform scope, broader memory OS framing, infrastructure and feature breadth beyond most OSS adopters' needs | Learn from the ambition, reject the default heaviness |
| **MemOS** | Tool memory, feedback correction, local/cloud split, stronger maintenance ambition | Memory OS-level breadth, larger infrastructure footprint, turning every adopter into a platform operator | Keep feedback and maintenance as first-class ideas, but stay library-first and avoid platform-first complexity |

### The distilled design stance

GoodMemory should aim to be:

> as easy to adopt as Mem0, as aware of long-session reality as Claude Code, as serious about provenance as Zep, but without the default heaviness of a memory OS platform.

This is the right balance for an OSS memory layer intended to be integrated into many other products.

---

## 10. GoodMemory v1 Thesis

This section cross-validates the current implementation-oriented architecture against the higher-level principles above.

### 10.1 What the current `v1` document gets right

The current [GoodMemory-OSS-Architecture-v1.md](./GoodMemory-OSS-Architecture-v1.md) already gets several important things right:

- it treats memory as more than vector search
- it separates runtime and durable concerns better than most libraries
- it recognizes maintenance as necessary
- it takes explainability seriously
- it avoids turning v1 into a product control plane

That makes it a strong **implementation-oriented companion document**.

### 10.2 Where the current `v1` document is still biased

There are four important biases to correct at the top level.

#### Bias 1: it exposes internal complexity too early

The current `v1` document surfaces many internal capabilities before it fully explains the simple external mental model.

Correction:

- externally, emphasize the minimal API and default integration path
- internally, keep advanced mechanisms in the reference architecture section

#### Bias 2: it leans too far toward agent runtime framing

The current `v1` document is strong on coding-agent realities, but its top-level framing can make GoodMemory feel more like an agent infrastructure layer than a user-facing continuity layer.

Correction:

- restore the top-level definition of GoodMemory as an LLM-user memory layer
- treat coding agents as one important integration mode, not the primary definition

#### Bias 3: `verify` is implied, but not elevated

The current `v1` document mentions stale memory and verification ideas, but does not elevate verification to an irreducible responsibility.

Correction:

- make `verify` a first-class responsibility alongside write, recall, compose, and maintain

#### Bias 4: memory hygiene is too low in the hierarchy

The current `v1` document includes strong hygiene rules, but mostly under policy or lifecycle sections.

Correction:

- elevate memory hygiene into first principles
- make "do not persist what can be re-derived" a canonical rule of the system

### 10.3 What v1 should be

GoodMemory v1 should be:

- a library-first OSS memory layer
- focused on LLM-user continuity
- easy to integrate into chatboxes and agents
- strong on semantic, episodic, procedural, and runtime memory
- capable of maintenance, but not dependent on platform complexity

### 10.4 What v1 should not be

GoodMemory v1 should not be:

- a universal memory operating system
- a graph-first memory platform
- a multimodal platform by default
- a UI-heavy managed product
- a framework-coupled memory abstraction

### 10.5 The relationship between the two documents

This document should be the stable, external-facing design thesis.

The companion [GoodMemory-OSS-Architecture-v1.md](./GoodMemory-OSS-Architecture-v1.md) should remain the detailed implementation blueprint that answers:

- module boundaries
- internal data model details
- adapter boundaries
- maintenance mechanisms
- roadmap and build sequencing

Together they serve different purposes:

- **this document**
  explains what GoodMemory is and why it should be designed this way
- **the companion `v1` document**
  explains how to build it

---

## Final Thesis

From first principles, a good memory layer for LLM applications is not a store, not a profile service, and not an agent framework.

It is:

> a **user-aware context engine** that decides what to remember, what to recall, how to compose it for the model, when to verify it, and how to maintain it over time.

That is the design center for GoodMemory.

Everything else should remain in service of that idea.
