# GoodMemory Codex Coding Effect Evaluation and Development Plan

Status: active design and development plan  
Priority: Codex first  
Claude Code: explicitly deferred until the Codex claim gate closes  
Scope: evaluation and evidence infrastructure; production changes only when a
real host canary proves a product defect  
Last reviewed: 2026-07-15

## 0. Executive Decision

GoodMemory currently has evidence that its memory layer can recall, update, and
apply information across long histories. It does not yet have direct evidence
that enabling GoodMemory makes a real coding agent produce better code.

The missing proof is not another answer-quality benchmark. The missing proof is
a host-native, paired A/B evaluation in which real Codex processes edit real
repositories and are scored by hidden tests.

This plan creates that evidence lane with the following hard decisions:

1. Codex is the only required host for the first complete lane.
2. The primary outcome is executable patch correctness, not an LLM judge.
3. GoodMemory and no-memory runs use the same Codex version, model, repository,
   prompt, tool permissions, wall-clock budget, and initial repository state.
4. Every session starts a fresh Codex process. Codex session resume is forbidden
   in the primary continuity protocol.
5. Every arm uses an isolated home, Codex state directory, GoodMemory state
   directory, workspace, and result directory.
6. Native Codex hooks are the primary installed-host path. Selecting the newest
   rollout file manually is a compatibility diagnostic, not the benchmark path.
7. The first pilot may use a small controlled dataset, but it cannot become a
   public performance claim.
8. Public promotion requires a larger paired dataset, three execution-order
   seeds, deterministic tests, a predeclared effect threshold, confidence
   intervals clustered by episode, and zero unresolved infrastructure failures.
9. No benchmark-specific selector or answer rule may enter production code.
10. Phase 72 MemGym CodeQA remains memory-isolated evidence and must not be
    relabeled as coding-effect evidence.

The target claim is narrow:

> On a versioned coding-continuity dataset, with a frozen Codex CLI version,
> model, repository state, task prompt, permissions, and budget, enabling the
> GoodMemory installed-host path changes hidden-test resolve@1 from A to B and
> reduces repeated failed approaches from C to D.

The first accepted claim must say Codex. It must not say Claude Code, coding
agents in general, developer productivity in general, or model intelligence.

## 1. Why This Lane Exists

### 1.1 Product thesis being tested

The coding-agent architecture says that GoodMemory should prioritize runtime
memory, procedural memory, episodes, and project facts so an agent can:

- preserve task continuity;
- remember validated approaches;
- remember explicit user corrections;
- continue long-running work without flooding the prompt.

These are causal product claims about future agent behavior. Retrieval recall,
memory QA, and context rendering are prerequisites, but they are not the final
outcome.

### 1.2 Current evidence boundary

The repository currently proves several important but narrower facts:

- installed-host setup can register Codex recall and writeback surfaces;
- selected durable state can be recalled in a later session;
- memory benchmarks show gains on long-history QA, conflict resolution,
  procedural behavior, and code-document fact recovery;
- MemGym CodeQA can show that code-related facts removed from context are
  recovered through memory.

The current MemGym runner does not:

- start Codex;
- let an agent inspect or edit repository files;
- produce a patch;
- run hidden tests;
- score regression tests;
- measure whether a previously failed approach is avoided.

Its current generated slice is therefore a mechanism diagnostic. It is not the
coding-effect lane described here.

### 1.3 Why a single SWE-style task is not sufficient

A single fresh issue is a weak test of durable memory:

- the repository itself may contain all required facts;
- the model may solve the issue from pretrained knowledge;
- no previous session exists to remember;
- there is no correction, prior failure, or open loop to carry forward;
- a memory system can add overhead without receiving a fair opportunity to help.

The evaluation unit must therefore be an episode with multiple sessions or a
stream of related tasks. Task position one establishes history. Positions two
and later measure whether that history improves executable outcomes.

## 2. Goals, Non-Goals, and Claim Boundaries

### 2.1 Goals

The first complete Codex lane must answer:

1. Does GoodMemory improve hidden-test pass rate after a fresh-session handoff?
2. Does GoodMemory improve complete episode success?
3. Does GoodMemory reduce repeated exploration and repeated failed approaches?
4. Does GoodMemory preserve explicit project constraints and corrections?
5. Does GoodMemory correctly suppress or supersede stale guidance?
6. Does it avoid harming tasks that have no relevant prior memory?
7. What additional token, latency, tool-call, and model-call cost buys the
   measured improvement?
8. Did native hook injection and native Stop writeback actually run for every
   GoodMemory session?
9. Can a third party reproduce the result from a frozen package, dataset
   manifest, Codex configuration, and report identity?

### 2.2 Non-goals

The first Codex lane will not:

- implement Claude Code parity;
- build a generic multi-host evaluation framework;
- claim that memory improves every coding task;
- rank Codex against Claude Code;
- use LLM-as-judge as the primary correctness metric;
- optimize GoodMemory against hidden answers or gold patches;
- add case IDs, repository names, expected file paths, or benchmark labels to
  production recall logic;
- publish a result from a four-instance or smoke-scale dataset;
- treat a clean integration run as a successful coding task;
- treat a green repository unit-test suite as benchmark closure;
- expose raw user transcripts, credentials, or unredacted host state in tracked
  reports;
- silently remove timed-out, crashed, or malformed runs from denominators.

### 2.3 Evidence classes

Every report must declare exactly one evidence class:

| Evidence class | Meaning | Public claim eligible |
| --- | --- | --- |
| host-canary | Native hooks, injection, writeback, and ledger work | No |
| deterministic-smoke | Dataset, workspace, scoring, and reports work without a live model | No |
| frozen-prehistory-pilot | Identical prior history isolates recall/injection effect | No |
| native-longitudinal-pilot | Real multi-session Codex end-to-end pilot | No |
| codex-coding-effect-candidate | Full paired run eligible for gate review | Maybe |
| codex-coding-effect-accepted | Accepted gate and claim declaration | Yes |

The evidence class is a field in run identity, not prose inferred from a
directory name.

## 3. First-Principles Constraints

### 3.1 Change one causal variable

Within a paired comparison, the intended product variable is:

> GoodMemory installed-host durable continuity enabled versus disabled.

Everything else must be held constant or explicitly disclosed:

- Codex CLI version and executable hash;
- Codex model and reasoning configuration, including reasoning-effort value;
- repository URL, license, commit, and prepared snapshot hash;
- issue prompt, stage prompt, and exact prompt hash;
- AGENTS.md and other repository-instruction file hashes;
- shell environment and dependency cache;
- sandbox, tool permissions, and network policy;
- token/tool budget and external wall-clock timeout;
- stage test harness;
- order seed and repetition number.

The complete host configurations cannot be byte-identical because the installed
host configuration is the treatment. The runner must instead persist both
arm-specific configurations plus a normalized configuration diff, while proving
the invariant fields above are identical.

### 3.2 Measure the product, not an internal shortcut

The native-longitudinal protocol must exercise packaged product surfaces:

- package or tarball installation;
- GoodMemory setup for Codex through the packaged public CLI;
- native SessionStart/UserPromptSubmit injection;
- native Stop writeback;
- installed storage;
- public CLI status and audit surfaces.

The C3 frozen-prehistory installed arm specifically uses packaged
`goodmemory setup --recommended --host codex --user-id <id> --yes --json` with
isolated global activation. It does not call workspace `goodmemory enable`:
setup must not create a task-workspace `.goodmemory` directory or mutate
AGENTS.md or any other repository instruction. A later protocol that deliberately
tests workspace activation must be named and reported as a different treatment.

The benchmark runner must not call createGoodMemory or internal host functions
to simulate success in the product-effect arm.

Internal calls remain acceptable in deterministic unit tests for parsers,
scorers, and report builders. They are not accepted as live host evidence.

### 3.3 Keep task correctness outside the agent

Gold patches and hidden tests must never be present in:

- the Codex worktree;
- the prompt;
- AGENTS.md;
- GoodMemory storage;
- hook output;
- MCP results;
- visible test output before the stage is finalized.

Hidden tests run from an evaluator-owned path after Codex exits. Their complete
result may be used to score the stage. It may enter a later stage only when the
episode manifest explicitly declares that feedback as user-visible history for
both arms.

### 3.4 Separate installed-default proof from enhanced integration proof

The primary public lane uses one named product profile:

- installed-host selective writeback;
- the repository's recommended retrieval profile;
- explicit, versioned provider configuration when provider-backed extraction or
  reranking is part of that profile;
- no benchmark-only feedback calls;
- no gold-derived memory.

If an evaluator later calls feedback() using hidden-test outcomes, that becomes
a different profile named outcome-feedback. It must not be mixed into the
installed-host default claim.

### 3.5 Keep the benchmark outside production architecture

All new dataset contracts, task selectors, scoring logic, and report assembly
belong under scripts/ and tests/. Production src/ changes are allowed only for:

- a host bug reproduced by the native Codex canary;
- a generic observability field required by real users as well as the eval;
- a package-surface defect that prevents the installed product from running.

No hidden-test concept, episode ID, task stratum, benchmark repository name, or
expected memory dependency belongs in src/.

## 4. Evaluation Architecture

### 4.1 High-level flow

~~~mermaid
flowchart LR
  M["Versioned episode manifest"] --> P["Preflight and run identity"]
  P --> W0["Isolated no-memory workspace"]
  P --> W1["Isolated GoodMemory workspace"]
  W0 --> C0["Fresh Codex session"]
  W1 --> H1["Native GoodMemory hooks"]
  H1 --> C1["Fresh Codex session"]
  C0 --> D0["Patch and host trace"]
  C1 --> D1["Patch, host trace, memory trace"]
  D0 --> T0["External hidden tests"]
  D1 --> T1["External hidden tests"]
  T0 --> A["Paired stage result"]
  T1 --> A
  A --> E["Episode aggregation"]
  E --> R["Run report and claim boundary"]
~~~

### 4.2 Component boundaries

The evaluation code should use the following small boundaries:

1. Dataset loader
   - validates manifests;
   - resolves repository snapshots;
   - refuses duplicate episode/stage IDs;
   - never interprets model output.
2. Workspace preparer
   - creates isolated worktrees or copies;
   - installs dependencies before credentials enter the environment;
   - verifies the initial tree hash;
   - owns cleanup.
3. Codex executor
   - builds one explicit codex exec invocation;
   - streams JSONL events;
   - enforces external timeout;
   - returns process and usage evidence;
   - has no benchmark scoring logic.
4. GoodMemory arm controller
   - installs/enables the packaged host path;
   - verifies hook registration;
   - reads only public status/audit output for live evidence;
   - owns the arm's GoodMemory home.
5. Patch collector
   - captures git status, diff, untracked files, and hashes;
   - rejects changes outside the workspace;
   - does not decide correctness.
6. Test evaluator
   - runs hidden and protection tests outside the Codex process;
   - normalizes exit codes and timeouts;
   - distinguishes infrastructure failure from task failure.
7. Artifact writer
   - writes append-only attempts;
   - persists run identity before the first live call;
   - supports strict resume;
   - never computes headline metrics.
8. Aggregator
   - consumes finalized stage artifacts;
   - computes paired deltas and confidence intervals;
   - refuses incomplete pairs or mixed identities.
9. Gate
   - checks predeclared thresholds;
   - writes a gate artifact;
   - never mutates source results.

Do not combine these responsibilities in one large runner.

### 4.3 No premature host abstraction

The first implementation should expose Codex-specific types:

- CodexRunRequest;
- CodexRunResult;
- CodexEvent;
- CodexHookCanary;
- CodexUsageSummary.

Do not create CodingHost, UniversalAgentRunner, HostPlugin, or a host registry in
the first pass. When Claude work begins, compare the two real implementations
and extract only the shared stable result contract.

## 5. Experimental Protocols

Two protocols are required because they answer different causal questions.

### 5.1 Protocol A: frozen-prehistory

Question:

> Given identical past information and an identical current coding task, does
> GoodMemory's selective storage and recall improve the current Codex patch?

Procedure:

1. Construct one native Codex rollout prehistory artifact for an episode.
2. Hash it, copy it into an evaluator-owned sealed read-only location, and
   validate that it contains no gold patch or hidden-test leakage.
3. Persist immutable run identity, including the sealed history hash, before
   any seed operation.
4. Initialize the GoodMemory arm only through packaged public
   `goodmemory codex writeback --from-rollout --rollout-path <sealed>`, not
   `goodmemory remember` or an internal repository API.
5. Persist an exact seed receipt binding source hash, session digest, written
   outcome, memory IDs, and public export hash; run a post-seed export leakage
   audit before starting Codex.
6. Leave the no-memory arm without durable history.
7. Start a fresh Codex process in each arm from the same current repository
   snapshot.
8. Provide the same current prompt.
9. Wait for both Codex processes to exit, then materialize the evaluator-owned
   hidden tests so neither live arm can inspect them.
10. Run the same external hidden tests and compare the paired patches/results.

This protocol isolates the memory channel. It does not prove that native Codex
writeback can automatically create the same useful history; that is tested by
Protocol B and the host canary.

Frozen prehistory must be generated before any A/B result is observed. It cannot
be rewritten after looking at failures.

### 5.2 Protocol B: native-longitudinal

Question:

> When users actually work through multiple fresh Codex sessions, does the
> installed GoodMemory path improve end-to-end coding outcomes?

Procedure:

1. Start both arms from paired repository snapshots.
2. Run stage one with a real fresh Codex process.
3. Let native Stop writeback run in the GoodMemory arm.
4. Persist the repository state according to the episode mode.
5. Start stage two in a new Codex process without resume.
6. Repeat for every stage.
7. Score each stage and the whole episode.

This protocol includes path dependence: an earlier patch may affect later work.
That is part of product behavior, but it makes causal diagnosis harder.
Therefore Protocol B must be accompanied by Protocol A on a diagnostic subset.

### 5.3 Repository-state modes

Each episode declares one mode:

#### canonical-snapshot

Every stage starts from a predeclared repository snapshot that is identical
across arms. Only memory history differs.

Use for:

- causal diagnosis;
- failure-avoidance transfer;
- repository convention transfer;
- correction and stale-memory cases.

#### persistent-branch

Each arm carries its own previous code changes into the next stage.

Use for:

- realistic handoff;
- multi-step feature completion;
- regression follow-up;
- episode-level product value.

Persistent-branch results must report cascade failures separately. A failed
stage may make later stages impossible; later failures remain in the episode
denominator and cannot be discarded.

### 5.4 Session rule

Every stage must use a new Codex session:

- do not use codex exec resume;
- do not reuse a thread ID;
- do not rely on the previous process context window;
- do not pass the previous transcript in the current prompt;
- do not keep a hidden terminal process alive between stages.

The repository may persist according to the declared state mode. Codex session
state may not.

## 6. Experimental Arms

### 6.1 Required pilot arms

#### no-memory

- isolated Codex home;
- no GoodMemory hook, MCP, exported memory file, or GoodMemory instruction;
- no native Codex durable memory, Chronicle history, resumed thread, or cloud
  history from previous benchmark runs;
- no non-benchmark plugin, skill, hook, rules file, or MCP server;
- native Codex memory-like features are explicitly disabled when supported; if
  they cannot be disabled, the isolated account/home must be proved empty and
  that limitation recorded;
- same repository AGENTS.md and task instructions as the GoodMemory arm;
- same Codex model and permissions.

#### goodmemory-installed

- isolated Codex home;
- isolated GoodMemory home;
- packaged GoodMemory installed;
- packaged `setup --recommended --host codex --user-id <id> --yes --json` run
  once with isolated global activation;
- workspace `enable` not called, with no task-workspace `.goodmemory` or
  repository-instruction mutation;
- public status reports healthy global activation and workspace status with the
  `coding_agent` / `selective` profile and raw transcript persistence disabled;
- native hooks and MCP registered by the recommended profile;
- native hooks enabled and trusted in the isolated environment;
- exact provider and retrieval configuration recorded;
- no benchmark-only recall or feedback call.

The no-memory and installed arms must bind the same prepared snapshot, prompt
hash, Codex executable hash/version, model, reasoning effort, sandbox, budget,
and repository-instruction hashes. The installed host files are intentionally
different; freeze and persist their normalized diff.

### 6.2 Required promotion control

#### flat-summary

This control answers:

> Is GoodMemory better than simply putting a compact history into the prompt?

Rules:

- uses the same frozen prehistory as GoodMemory;
- summary is generated once before A/B execution;
- summarizer model, prompt hash, and output hash are pinned;
- injected summary has the same maximum token budget as GoodMemory context;
- no dynamic recall, supersession, provenance selection, or writeback;
- current Codex model remains unchanged.

The summary arm is not required to validate the initial harness. It is required
before claiming that GoodMemory's memory policy is better than extra context.

### 6.3 Optional diagnostic arms

#### instruction-sham

Use this arm when GoodMemory setup changes static host instructions or tool
descriptions in a way that the no-memory arm does not receive.

- carries the same GoodMemory-generated static instructions and hook process
  overhead;
- uses an empty store;
- returns no recalled context;
- does not perform durable writeback;
- proves whether a gain comes from durable memory or merely from changed host
  instructions.

The runner must always write a normalized static-configuration diff between
arms. If the diff is non-empty and instruction-sham was not run, the public
claim is about the complete installed GoodMemory treatment, not memory alone.

#### oracle-memory

- contains only the manifest-declared required prior facts;
- contains no implementation answer or gold patch;
- establishes an upper bound on the value of perfect recall;
- is internal diagnostic evidence only.

Oracle-memory cannot appear in the public headline comparison.

### 6.4 Arm isolation

For every episode, seed, repetition, and arm, allocate unique:

- HOME;
- CODEX_HOME;
- GOODMEMORY_HOME;
- workspace path;
- result path;
- port range if any local service is needed;
- memory user ID;
- memory workspace ID;
- session IDs;
- dependency/runtime temporary directory where practical.

The run must fail preflight if two arms resolve to the same path or scope.

## 7. Dataset and Episode Design

### 7.1 Dataset levels

#### Level 0: harness fixtures

- tiny repository created for tests;
- no live LLM required;
- deterministic fake Codex process;
- validates workspace, patch capture, hidden tests, resume, and reports.

#### Level 1: controlled pilot

- 6 episodes;
- at least 2 repositories;
- at least 3 stages per episode;
- covers all required memory strata;
- may use controlled mutations and authored hidden tests;
- intended only to find integration and measurement defects.

#### Level 2: expanded candidate

- minimum 30 episodes before power-analysis adjustment;
- minimum 90 scored stages;
- at least 6 repositories;
- at least 2 programming-language ecosystems;
- mix of controlled mutations and real-history tasks;
- three execution-order seeds;
- public-source licenses and immutable repository commits.

#### Level 3: public claim set

The final size is selected after the pilot using the observed paired-discordance
rate. Repeated seeds do not magically create independent episodes. Power and
confidence calculations cluster by episode.

The claim set must have enough paired episodes for the lower bound of the 95%
confidence interval to exceed zero at the predeclared material-effect gate.

### 7.2 Required strata

Every dataset manifest reports counts for:

1. open-loop handoff
   - prior session leaves a concrete next step;
   - current task requires continuing it.
2. validated approach
   - previous session established a working command, API, or implementation
     pattern;
   - current task benefits from reusing it.
3. failure avoidance
   - previous session tried an approach and observed a clear failure;
   - current task should not repeat it.
4. user correction
   - user rejects a behavior or design;
   - later task should follow the correction.
5. project convention
   - relevant convention is expensive to rediscover or absent from the current
     prompt;
   - later patch must comply.
6. stale update
   - an earlier instruction is superseded;
   - current task must follow the newer instruction.
7. irrelevant-memory negative control
   - prior history exists but is unrelated;
   - GoodMemory should avoid distracting Codex.
8. no-history negative control
   - stage one has no useful memory;
   - GoodMemory should not claim a benefit or cause a regression.

Results must be shown per stratum. A high aggregate score cannot hide failure on
stale-update or negative-control cases.

### 7.3 Episode requirements

Every episode must declare:

- stable episode ID;
- source type: controlled-mutation, real-history, or external-benchmark;
- repository URL;
- repository license;
- base commit;
- prepared snapshot hashes per stage;
- state mode;
- language/ecosystem;
- build preparation command;
- visible test command, if any;
- hidden fail-to-pass test command;
- hidden pass-to-pass protection command;
- external timeout;
- stages and prompts;
- prior-history source;
- allowed user-visible feedback between stages;
- expected memory dependency categories;
- forbidden leakage strings or file hashes;
- gold patch location outside the agent workspace;
- task provenance and author;
- whether the episode is pilot-only or claim-eligible.

### 7.4 Task selection rules

Accept a task only when:

- the gold state passes all hidden and protection tests;
- the base state fails at least one fail-to-pass test;
- the task can be built from a pinned environment;
- hidden tests do not need credentials;
- the prompt is solvable without seeing the gold patch;
- the memory dependency is meaningful rather than a trivia password;
- no task-specific exception is required in the generic runner;
- the repository license allows the intended evaluation and artifact handling.

Reject a task when:

- the answer is directly present in the prompt;
- the hidden test name reveals the exact fix;
- the task depends on flaky external services;
- package installation requires uncontrolled latest versions;
- the task is impossible without a secret;
- the evaluator must manually reinterpret whether the patch is correct;
- the task was added only because GoodMemory already happened to solve it;
- the task requires modifying benchmark scoring to count as passed.

### 7.5 Leakage audit

Before live execution, a deterministic audit must compare:

- prompts;
- AGENTS.md and repository instructions;
- visible repository files;
- frozen prehistory;
- flat summary;
- GoodMemory export after seeding;
- gold patch;
- hidden test source;
- expected changed files.

The audit reports exact and normalized substring overlaps. It blocks:

- gold patch hunks in history;
- hidden assertion text in prompts or memory;
- explicit expected file paths that are not naturally user-visible;
- generated summaries that reproduce hidden answers;
- memory seeded from a future commit.

The audit result is persisted before the first Codex call.

## 8. Codex Host Execution Contract

### 8.1 Preflight

Before a run, record and verify:

- codex executable path;
- codex --version output;
- executable SHA-256;
- codex features list output;
- hooks feature status;
- selected model;
- selected reasoning configuration;
- git version;
- Bun/Node/Python versions needed by the task;
- platform, architecture, CPU count, and memory;
- network mode;
- GoodMemory executable path and version;
- package/tarball SHA-256;
- repository commit and dirty-state policy;
- hook configuration file hashes;
- resolved arm paths.

If hooks are unavailable, the goodmemory-installed arm does not silently switch
to manual rollout selection. The run stops as a host-preflight failure.

### 8.2 Invocation

The executor must use non-interactive JSONL output and explicit settings. The
exact flags are frozen in run identity after being verified against the installed
Codex version.

Illustrative shape:

~~~text
codex exec
  --json
  --sandbox workspace-write
  --ask-for-approval never
  --model <frozen-model>
  --cd <isolated-workspace>
  <stage-prompt>
~~~

Do not copy this command blindly into implementation. The command builder test
must verify the actual installed CLI reference and final argument vector.

Do not use --ephemeral in the native writeback lane until a live canary proves
that Stop transcript hydration and ledger capture remain available before
ephemeral cleanup.

### 8.3 Permissions

The live benchmark runs in an externally isolated environment:

- workspace write only;
- no access to sibling arm directories;
- no access to hidden tests or gold patch;
- no ambient SSH agent;
- no cloud credentials;
- no GitHub write token;
- network disabled when task dependencies are preinstalled;
- otherwise a pinned allowlist disclosed in run identity.

Approval prompts are disabled only inside this isolated runner. This is not a
recommended user configuration.

### 8.4 Native hook canary

Every goodmemory-installed stage must prove:

1. Codex loaded the expected hooks configuration.
2. The canary is bound to the current stage's exact new Codex thread ID.
3. SessionStart or UserPromptSubmit produced an injection decision containing
   every seed receipt memory ID required by the task.
4. The injected content hash, selected record IDs, and sanitized exact-thread
   transcript hash were captured without accepting model response text.
5. The current session cursor advanced.
6. Stop fired for that exact thread and provided a readable transcript source
   or equivalent supported payload.
7. GoodMemory writeback returned a committed terminal outcome for the current
   thread, and the ledger binds its current session digest.
8. No raw transcript was persisted when the profile forbids it.

Allowed injection outcomes:

- injected;
- empty-context;
- low-relevance;
- duplicate-context when valid for the same session.

For tasks that declare required prior memory, empty-context, low-relevance, or a
missing expected record is a memory-channel failure, not a normal successful
canary.

Any current-stage injection, transcript, cursor, Stop, or terminal-writeback
failure is an installed-arm infrastructure failure. The runner must retain the
patch and deterministic test statuses for diagnosis, but it must not fall back
to no-memory behavior; the paired result is incomparable.

### 8.5 Transcript format drift

Codex documents transcript_path as a convenience path whose format may change.
The runner therefore treats transcript parsing as an external boundary:

- persist Codex version and transcript file hash;
- parse with a versioned parser contract;
- emit detailed structured logs for the first invalid line and parser state;
- never silently fall back to an empty transcript;
- retain the failed attempt artifact;
- classify the run as hook-writeback infrastructure failure;
- add a focused parser fixture before changing production code.

### 8.6 Event capture

Persist the original Codex JSONL event stream locally, subject to redaction and
license policy. Derive a normalized trace containing:

- thread/session ID;
- turn start/end;
- model usage;
- command executions and exit codes;
- file changes;
- MCP calls;
- plan updates;
- tool errors;
- final agent message;
- timeout/termination state.

Normalization must retain source event indexes so every derived metric can be
audited against raw events.

## 9. GoodMemory Installed-Host Contract

### 9.1 Product configuration

The selected product profile must be explicit and frozen. At minimum record:

- GoodMemory package version and artifact hash;
- storage provider and database path;
- writeback mode;
- raw-transcript persistence setting;
- assistant-output policy;
- extraction strategy and model;
- retrieval preset and context mode;
- per-prompt and session-start token budgets;
- relevance gate;
- embedding/reranking provider roles when enabled;
- MCP registration and write permission;
- maintenance behavior.

New GoodMemory-owned non-judge LLM calls use the repository's current pinned
non-judge model policy. Any LLM judge remains a different model and is secondary
to deterministic tests.

### 9.2 Primary profile

The first candidate profile should be named:

goodmemory-installed-recommended

It should represent a configuration a real adopter can reproduce. If it uses
provider-backed extraction, embeddings, or reranking, the report must include
their cost and cannot describe the result as zero-dependency.

### 9.3 Public-surface rule

For a live candidate:

- run packaged
  `goodmemory setup --recommended --host codex --user-id <id> --yes --json`
  in an isolated home with global activation;
- do not call workspace `enable` for the C3 installed arm, and prove setup did
  not create task-workspace `.goodmemory` state or alter repository instructions;
- inspect status through the packaged CLI;
- require public status to report healthy global activation/workspace status,
  `coding_agent` / `selective`, raw transcript persistence disabled, and hooks
  plus MCP registered;
- inspect writeback/audit through the packaged CLI or versioned admin API;
- use native Codex hook output;
- avoid importing src/install modules from the benchmark runner.

This protects the claim from proving only repository-internal composition.

### 9.4 Memory trace

For every stage, persist a sanitized trace with:

- memory IDs considered;
- selected record IDs;
- memory type;
- source session digest;
- relevance score or selection reason;
- supersession/verification state;
- injection decision;
- injected token estimate;
- writeback candidates;
- accepted/rejected/observed counts;
- warnings and provider errors;
- recall and writeback latency;
- whether each recalled record was referenced by the final Codex trajectory.

The trace is diagnostic. It does not decide patch correctness.

## 10. Workspace and Test Harness

### 10.1 Workspace lifecycle

For each stage:

1. Resolve the canonical source snapshot.
2. Create an isolated workspace.
3. Verify commit and tree hash.
4. Apply only manifest-declared stage preparation.
5. Install dependencies before adding model credentials.
6. Run a base-health probe.
7. Start Codex.
8. Wait for Codex and hooks to finish.
9. Capture patch and file inventory.
10. Remove model credentials from the test environment.
11. Attach hidden tests from an evaluator-owned path. For a C3 paired pilot,
    this materialization occurs only after both Codex arm processes have exited.
12. Run fail-to-pass and pass-to-pass suites.
13. Write immutable stage results.
14. Cleanup unless keep-workspaces is explicitly enabled.

### 10.2 Base-health probe

The base-health probe distinguishes a broken fixture from a legitimate failing
task:

- required protection tests pass;
- declared fail-to-pass tests fail in the expected way;
- build tools resolve;
- dependency lock hashes match;
- no previous patch or untracked output exists.

An unhealthy base is a dataset infrastructure failure and blocks every arm for
that stage.

### 10.3 Patch capture

Capture:

- git status --porcelain;
- git diff --binary;
- untracked-file archive or manifest;
- submodule status if applicable;
- patch SHA-256;
- changed file list;
- added/deleted line counts;
- whether forbidden paths changed.

A final message that claims success with no patch is still a failed coding task
unless the manifest explicitly defines a no-code task. The public coding-effect
set should contain no no-code tasks.

### 10.4 Test result contract

Every test command produces:

- command ID;
- exact argv;
- cwd;
- environment allowlist hash;
- start/end timestamps;
- timeout;
- exit code or signal;
- stdout/stderr paths and sanitized hashes;
- parsed test counts when supported;
- fail-to-pass status;
- pass-to-pass status;
- infrastructure classification.

Correctness is:

- all required fail-to-pass tests pass; and
- all required pass-to-pass tests pass; and
- no forbidden file/path change occurred; and
- no unresolved execution failure occurred.

LLM interpretation cannot override this result.

## 11. Metrics and Statistical Design

### 11.1 Primary metrics

Report per arm and paired delta for:

- stage resolve@1;
- task positions two and later resolve@1;
- episode completion rate;
- fail-to-pass success rate;
- pass-to-pass protection rate;
- memory-dependent stratum resolve@1.

The headline metric is positions-two-and-later resolve@1 because task position
one has no accumulated GoodMemory advantage.

### 11.2 Paired outcome table

For every primary metric report:

| Baseline | GoodMemory | Meaning |
| --- | --- | --- |
| fail | pass | rescue |
| pass | fail | regression |
| pass | pass | shared success |
| fail | fail | shared failure |

Rescue and regression counts are mandatory. Average accuracy alone hides harm.

### 11.3 Secondary efficiency metrics

- wall-clock time per stage;
- Codex input/output/reasoning tokens when reported;
- GoodMemory provider tokens and cost;
- total cost per resolved stage;
- command count;
- file-read/search command count;
- test command count;
- repeated identical or equivalent failed commands;
- time to first relevant file edit;
- time to first passing visible test;
- final patch size.

### 11.4 Memory-behavior metrics

- required-memory recall coverage;
- recalled-memory precision;
- irrelevant injection rate;
- stale-memory use rate;
- explicit correction compliance;
- repeated-failed-approach rate;
- empty-context rate;
- low-relevance suppression rate;
- memory-induced regression rate;
- hook/writeback success rate.

These explain the coding result. They do not replace it.

### 11.5 Repetition and ordering

- run three independent execution-order seeds for candidate/full evaluation;
- randomize arm order inside each episode/seed pair;
- complete paired arms close in time to reduce model/provider drift;
- persist exact start/end timestamps;
- never run all baseline arms days before all GoodMemory arms;
- do not count repeated seeds as independent repositories.

### 11.6 Confidence intervals

Use paired bootstrap with the episode as the resampling cluster:

- 10,000 bootstrap samples;
- preserve all stages and repetitions inside an episode cluster;
- report 95% percentile interval;
- report the raw paired discordance table;
- additionally report McNemar's test for binary stage outcomes as a diagnostic;
- do not use the p-value as the only acceptance criterion.

### 11.7 Power and dataset size

The six-episode pilot estimates:

- baseline resolve rate;
- rescue rate;
- regression rate;
- within-episode correlation;
- infrastructure failure rate;
- per-episode cost.

Then compute the required episode count for the predeclared material effect.

Minimum promotion floor:

- at least 30 episodes;
- at least 90 scored stages;
- at least 6 repositories;
- at least three execution-order seeds.

If power analysis requires more, the larger requirement wins.

### 11.8 Exclusion rules

Task failures are never excluded.

An attempt may be excluded from the finalized pair only when:

- the failure stage is predeclared as infrastructure;
- the paired arm did not receive a valid comparable opportunity;
- the failed attempt remains in attempts.jsonl;
- the rerun uses the same run identity and a new attempt ID;
- the summary reports attempted, retried, and finalized counts.

Examples of infrastructure failure:

- Codex binary cannot start;
- provider transport outage before a turn begins;
- hook configuration not loaded;
- transcript parser incompatibility;
- evaluator filesystem failure;
- base fixture fails health checks;
- hidden-test container fails to start.

Examples of task failure:

- Codex times out while reasoning;
- Codex produces no patch;
- Codex changes the wrong files;
- tests fail;
- Codex repeats a failed approach;
- GoodMemory injects irrelevant memory and the patch regresses.

The final claim artifact requires zero unresolved infrastructure failures. It
does not erase the failed-attempt ledger.

## 12. Report and Artifact Contract

### 12.1 Directory layout

~~~text
reports/eval/research/codex-coding-effect/<run-id>/
├── run-identity.json
├── dataset-manifest.json
├── leakage-audit.json
├── attempts.jsonl
├── progress.jsonl
├── cases.jsonl
├── summary.json
├── claim-boundary.json
├── failures/
│   └── summary.json
└── episodes/
    └── <episode-id>/
        └── <seed>/
            └── <arm>/
                └── <stage-id>/
                    ├── prompt.txt
                    ├── codex-events.jsonl
                    ├── codex-normalized.json
                    ├── stdout.log
                    ├── stderr.log
                    ├── hook-canary.json
                    ├── memory-trace.json
                    ├── writeback-audit.json
                    ├── git-status.txt
                    ├── patch.diff
                    ├── patch-metadata.json
                    ├── visible-tests.json
                    ├── hidden-tests.json
                    ├── resource-usage.json
                    └── stage-result.json
~~~

Raw/high-volume artifacts may remain gitignored. The accepted gate and sanitized
summary must be tracked.

### 12.2 Run identity

run-identity.json is written before any live call and contains:

- schema version;
- run ID;
- evidence class;
- GoodMemory source commit and dirty diff hash;
- package version and tarball hash;
- Codex version, executable hash, model, and config hash;
- dataset manifest hash;
- episode IDs and stage IDs;
- arm definitions;
- seeds and repetitions;
- prompt/template hashes;
- hook configuration hashes;
- dependency/container image hashes;
- platform information;
- timeout and concurrency budgets;
- statistics/gate version;
- output root.

Resume must byte-compare identity. Any mismatch fails before reading progress.

### 12.3 Stage result

Each stage result includes:

- episode/stage/arm/seed/repetition IDs;
- attempt ID;
- state mode;
- source and prepared commit hashes;
- Codex process result;
- hook canary result;
- memory trace references;
- patch metadata;
- visible and hidden test results;
- resolved boolean;
- execution failure stage/message;
- task failure reasons;
- usage/cost;
- artifact hashes;
- timestamps.

### 12.4 Summary

summary.json includes:

- total selected episodes/stages;
- attempted/finalized counts;
- execution failures by stage;
- arm profile summaries;
- paired rescue/regression table;
- primary and secondary deltas;
- per-stratum metrics;
- per-position metrics;
- confidence intervals;
- cost metrics;
- memory-behavior metrics;
- source report hashes;
- gate inputs, but not the gate decision.

### 12.5 Claim boundary

claim-boundary.json declares:

- claimable: true/false;
- exact eligible claim text template;
- host: Codex;
- excluded hosts;
- dataset scope;
- model/version scope;
- profile scope;
- primary metric;
- known limitations;
- internal-only diagnostics;
- whether raw artifacts are available;
- whether all source licenses permit the claim;
- whether the full gate has been accepted.

## 13. Implementation Layout

Proposed evaluation-only files:

~~~text
scripts/
├── codex-coding-effect/
│   ├── contracts.ts
│   ├── cli-options.ts
│   ├── dataset.ts
│   ├── leakage-audit.ts
│   ├── workspace.ts
│   ├── codex-runner.ts
│   ├── codex-events.ts
│   ├── goodmemory-arm.ts
│   ├── hook-canary.ts
│   ├── patch.ts
│   ├── tests.ts
│   ├── attempts.ts
│   ├── reporting.ts
│   ├── statistics.ts
│   └── gate.ts
├── run-codex-coding-effect.ts
├── summarize-codex-coding-effect.ts
└── run-codex-coding-effect-gate.ts

tests/
├── unit/
│   ├── codex-coding-effect.dataset.test.ts
│   ├── codex-coding-effect.leakage.test.ts
│   ├── codex-coding-effect.cli.test.ts
│   ├── codex-coding-effect.events.test.ts
│   ├── codex-coding-effect.patch.test.ts
│   ├── codex-coding-effect.scoring.test.ts
│   ├── codex-coding-effect.reporting.test.ts
│   ├── codex-coding-effect.resume.test.ts
│   └── codex-coding-effect.gate.test.ts
├── integration/
│   ├── codex-coding-effect.workspace.test.ts
│   ├── codex-coding-effect.fake-host.test.ts
│   └── codex-native-stop-writeback.test.ts
├── eval/
│   └── codex-coding-effect.pilot.test.ts
└── release/
    └── codex-coding-effect-claim.test.ts
~~~

Do not create all files on day one. Create them in the TDD order below and keep
modules small enough to own one external boundary.

### 13.1 Reuse versus extraction

Reuse existing Codex JSON event parsing and runtime-resolution helpers where
their contracts fit.

Do not move production code solely to make eval imports prettier. If the
Phase 31 live runner already contains reusable process-spawn behavior, extract
an eval-side helper only after a focused regression test captures the old path.

### 13.2 Package scripts

Proposed commands:

~~~text
eval:codex-coding-effect:smoke
eval:codex-coding-effect:canary
project:codex-coding-effect:c2-evidence
eval:codex-coding-effect:pilot
eval:codex-coding-effect:full
summarize:codex-coding-effect
gate:codex-coding-effect
~~~

The canonical bun test suite must not run live Codex or provider calls.

## 14. CLI Contract

The full runner should support:

- --dataset-root;
- --run-id;
- --output-dir;
- --episode-id, repeatable;
- --arm, repeatable;
- --seed, repeatable;
- --repetition-count;
- --codex-model;
- --reasoning-effort when supported by the frozen Codex version;
- --package-tarball;
- --max-concurrency;
- --stage-timeout-ms;
- --test-timeout-ms;
- --resume;
- --dry-run;
- --keep-workspaces;
- --workspace-root;
- --attempts-root;
- --network-mode;
- --evidence-class.

Requirements:

- duplicate scalar flags fail;
- malformed positive integers fail;
- empty or whitespace-padded values fail;
- run ID is a single path segment;
- output paths cannot overwrite dataset roots, package artifacts, or workspaces;
- repeated selectors are de-duplicated only when their order is not meaningful;
- incompatible evidence class/arm combinations fail before setup;
- full/public mode rejects pilot-only episodes;
- resume requires identical run identity;
- dry-run performs all deterministic validation and writes no result artifact.

## 15. Structured Logging and Diagnostics

This is a complex host/model/hook/filesystem/test chain. Detailed structured
logging is required at real boundaries.

Required events:

- run_preflight_started/completed;
- dataset_validated;
- leakage_audit_completed;
- pair_started/completed;
- workspace_prepared;
- goodmemory_setup_started/completed;
- hook_registration_verified;
- codex_process_started/exited;
- codex_event_parse_failed;
- injection_audited;
- stop_writeback_audited;
- patch_captured;
- hidden_tests_started/completed;
- stage_finalized;
- attempt_failed;
- resume_row_loaded/rejected;
- run_aggregated;
- gate_evaluated.

Every event contains:

- run ID;
- episode ID;
- stage ID;
- arm;
- seed;
- repetition;
- attempt ID;
- timestamp;
- correlation/trace ID;
- failure stage when relevant.

Logs must not include:

- API keys;
- auth.json content;
- complete environment dumps;
- unredacted private transcript text;
- hidden test source;
- gold patch.

Do not wrap every function in try/catch. Catch and classify errors only at:

- dataset boundary;
- workspace boundary;
- host process boundary;
- hook/transcript boundary;
- provider boundary;
- test process boundary;
- artifact-write boundary.

Inside pure logic, let errors propagate to the owning boundary.

## 16. TDD Development Order

### Phase C0: contract freeze

#### C0-T001: claim and evidence-class contracts

Write failing tests for:

- evidence class enumeration;
- claimable/non-claimable transitions;
- Codex-only host declaration;
- rejection of a Claude claim;
- rejection of MemGym/QA evidence as coding-effect evidence.

Implement minimal contracts.

#### C0-T002: dataset schema

Write failing tests for:

- valid controlled episode;
- duplicate IDs;
- missing license/commit;
- missing hidden/protection test;
- invalid persistent/canonical mode;
- pilot-only episode in full mode;
- gold path inside workspace;
- malformed memory strata.

Implement loader and validation.

#### C0-T003: strict CLI

Write failing tests for:

- duplicate scalar flags;
- repeated allowed selectors;
- path traversal;
- source/output collisions;
- invalid concurrency/timeouts;
- incompatible arms/evidence class;
- dry-run behavior.

Implement the parser without live execution.

C0 acceptance:

- all unit tests pass;
- dry-run resolves an immutable selection;
- no production files changed.

### Phase C1: deterministic harness

#### C1-T001: workspace lifecycle

Failing tests:

- clean workspace creation;
- source commit mismatch;
- dirty base rejection;
- sibling-arm path collision;
- cleanup and keep-workspaces behavior;
- base-health failure.

#### C1-T002: fake Codex executor

Provide a fixture executable that emits Codex-like JSONL and edits a tiny repo.

Failing tests:

- successful patch;
- non-zero host exit;
- timeout;
- malformed JSONL;
- partial final line;
- missing final message;
- command/file-change normalization.

#### C1-T003: patch and hidden-test scoring

Failing tests:

- correct patch;
- fail-to-pass failure;
- protection regression;
- no patch;
- forbidden path;
- untracked-file solution;
- test timeout;
- broken evaluator process.

#### C1-T004: attempts, progress, and resume

Failing tests:

- identity written before execution;
- append-only attempt;
- torn-tail tolerance only on final progress line;
- duplicate result rejection;
- out-of-scope row rejection;
- identity mismatch rejection;
- task failure retained and not replayed as infrastructure success.

C1 acceptance:

- a fake two-arm episode runs end to end;
- hidden tests determine correctness;
- summary is reproducible byte-for-byte except timestamps;
- no network or real Codex call occurs.

### Phase C2: native Codex hook canary

#### C2-T001: packaged host setup fixture

- build or accept a package tarball;
- install into an isolated prefix/home;
- run setup/enable;
- assert hooks and GoodMemory status through public CLI output.

#### C2-T002: native injection canary

- seed one non-sensitive durable memory;
- run a real Codex prompt that should retrieve it;
- assert native injection record and Codex event evidence;
- ensure the model response is not the acceptance criterion.

#### C2-T003: native Stop writeback canary

- run one real Codex turn containing a safe open loop;
- assert Stop fires;
- hydrate transcript;
- assert ledger entry;
- start a fresh session;
- assert the selected record is recallable.

#### C2-T004: transcript drift fixture

- capture a sanitized current Codex transcript fixture;
- add parser regression test;
- document version/hash;
- verify failure is explicit when shape changes.

C2 acceptance:

- native Codex Stop automatic writeback is proved end to end;
- no manual newest-rollout selection is used;
- raw transcript persistence policy is honored;
- any required production fix is minimal and has a regression test.

C2 implementation result (2026-07-15): **accepted as host-canary evidence**.
Run `c2-native-20260715-010` installed package SHA-256
`e16fc6ea5f284f9e8b0688360785839370857b3a4cfdaccacda1bb536ce50756`
into a fresh isolated home and prefix, then used Codex CLI 0.144.3 with
`gpt-5.6-sol` / `xhigh` for two distinct native-hook sessions. The first
session injected a pre-seeded record; native Stop hydrated the exact thread
transcript, advanced its session cursor, and committed one safe action record;
the second session injected that record and updated its public writeback recall
audit. Acceptance ignored model response text, did not select a rollout
manually, kept raw transcript persistence disabled, and deleted the isolated
runtime. The content-free current-wire fixture is
`fixtures/codex-coding-effect/codex-rollout-0.144.3.sanitized.jsonl`; its
version and hashes are pinned in the adjacent metadata JSON. The adjacent
`c2-native-host-canary.evidence.json` is generated from the run artifacts,
retains all ten attempts, binds the runner-time source commit/dirty diff and
safety-state artifact hashes, and explicitly discloses the BM25 prompt
calibration that preceded acceptance. This closes host correctness only. It is
not evidence that GoodMemory improves coding outcomes; that claim remains
blocked on C5-C7.

### Phase C3: arms and frozen-prehistory protocol

Status: **ACCEPTED AS FROZEN-PREHISTORY PROTOCOL/HOST EVIDENCE**.
The arm planning, packaged runtime preflight, frozen-prehistory
validation/sealing, strict seed receipt, stage evidence, reporting, and
current-stage canary contracts are implemented under unit and integration
tests. Final clean-clone run `c3-controlled-20260716-cleanclone-003` closes the
C3 protocol gate. Its `tie-both-pass` result is valid protocol evidence, not
coding-uplift evidence.

#### C3-T001: no-memory isolation

Tests prove:

- no GoodMemory files/hooks/MCP;
- no cross-run Codex state;
- identical static repository instructions;
- unique paths/scopes.

#### C3-T002: GoodMemory installed arm

Tests prove:

- packaged install only;
- packaged recommended global setup without workspace `enable`;
- no task-workspace `.goodmemory` or repository-instruction mutation;
- public global activation/workspace status is healthy and reports
  `coding_agent` / `selective`, raw persistence off, hooks, and MCP;
- expected profile persisted;
- current-stage canary binds exact thread, seed IDs, sanitized transcript hash,
  cursor advancement, and committed Stop writeback in the stage result;
- failures do not degrade to no-memory silently.

#### C3-T003: frozen prehistory

Tests prove:

- identical history source hash;
- no gold leakage;
- evaluator-owned sealed native rollout is written only after run identity;
- GoodMemory is seeded through packaged public `goodmemory codex writeback
  --from-rollout`, never `remember`;
- exact seed receipt, public export hash, and post-seed leakage audit persist;
- current Codex sessions start fresh;
- history cannot be edited after run identity.

#### C3-T004: flat-summary control

May be postponed until promotion work, but its contracts and token-budget
comparison should be designed now.

C3 acceptance:

- one real paired current task completes through two real Codex processes with
  distinct thread IDs;
- both arms bind the same snapshot, prompt/prompt hash, Codex executable
  hash/version, model, reasoning effort, sandbox, budget, and
  repository-instruction hashes;
- the runner-time GoodMemory source commit and tree are frozen before the first
  live call, the source tree must be clean, and the sanitized source-state
  digest is rechecked after the pair;
- the intentional arm-specific host-configuration diff is frozen and persisted;
- the installed current-stage canary is valid for the exact thread, injected
  seed IDs, sanitized transcript hash, cursor, and committed Stop event;
- evaluator-owned hidden tests are materialized only after both processes exit;
- deterministic hidden fail-to-pass and pass-to-pass tests alone score task
  correctness; memory diagnostics explain but never override the score;
- a canary/infrastructure failure has no fallback and makes the pair
  incomparable.
- the sanitized audit/config projections and pre/post source-state metadata are
  tracked so a clean clone can verify the accepted decision without committing
  raw diffs or untracked file contents.

Tie, rescue, and regression are all valid protocol outcomes. Completing this
pilot establishes only `frozen-prehistory-pilot` evidence: it is not proof of
uplift, is not eligible for a public coding-effect claim, and does not close the
later candidate/statistical gates.

C3 historical run result (2026-07-15): **observed, not accepted**. Run
`c3-controlled-20260715-1747z` installed GoodMemory 0.5.1 from tarball SHA-256
`341a9c82a26f8e231202bc57fd80af2545d32c11b9dbdbec8146d244bf4fda4d`
and executed two real, distinct Codex CLI 0.144.3 threads with
`gpt-5.6-sol` / `xhigh`. The controlled task used an independent clone; each
arm ran under a custom permission profile with filesystem-root deny, minimal
read, workspace write, network off, and explicit deny/read/write probes. The
no-memory Codex process exited before frozen prehistory materialization, and
both Codex processes exited before evaluator-owned hidden tests were
materialized.

The installed recall preflight injected the exact seeded memory ID. The real
current-session canary then injected the same expected ID, bound the sanitized
exact-thread transcript hash, advanced the session cursor, observed committed
turn-end writeback, and confirmed raw-transcript persistence remained false.
Both arms passed deterministic hidden fail-to-pass and pass-to-pass tests; the
two attempts were finalized and resolved with zero infrastructure failures.
The comparable result is `tie-both-pass`, and the summary records
`publicClaimEligible: false`. The local artifacts show that the treatment was
active, but the run identity did not record the runner-time GoodMemory source
commit/tree/dirty state or the required normalized host-configuration diff.
The raw report directory is also gitignored and has no tracked sanitized
projection. Those omissions make the run non-reproducible from a clean clone,
so it cannot satisfy C3 acceptance.

The hardened runner rejects a dirty GoodMemory source tree and persists
`goodmemory-source-state.json`, `goodmemory-source-state-post-run.json`,
`host-configurations.sanitized.json`, their hashes in `run-identity.json`, and
`audit-evidence.sanitized.json` at the appropriate lifecycle points. The source
artifacts contain only status sizes/digests and untracked path/size/digest
metadata, never the tracked diff or untracked file contents. Unmatched host
`PATH` entries project as `<host-path>`, while controlled runtime prefixes keep
stable placeholders only on complete path-prefix boundaries. The C3 CLI also
fails closed when any sensitive path resolves under `/tmp`, `/private/tmp`,
`/var/tmp`, or `/private/var/tmp`; Codex 0.144.5's macOS platform defaults
allow those scratch roots even when the permission profile contains an exact
deny. Both profiles exact-deny the current arm root and cross-arm state, and
both arms directly probe current and other-arm copied auth, configs, source,
evaluator, output, package, runner, workspace, and network boundaries
immediately before model launch.

C3 final result (2026-07-21): **internally accepted; source reproducibility
closed**. Run
`c3-controlled-20260716-cleanclone-003` used a clean mechanical runner snapshot
at commit `fc31f4f96f3975daea361805da3fc4fc942c5aa4` / tree
`996b1c24bfb53a9d9c62eb109997576df7b512af`, clean GoodMemory source
commit `594ee5406ff082f6210d4be4f763f529f13a1a9f` / tree
`af13dc2688a0e3636f2c2e40728a47eb52ce90eb`, package SHA-256
`4526fc05ee1fadf05ff80e555827af67477724bf5e0d4cd3613452b899a647c3`,
Codex CLI 0.144.5, and `gpt-5.6-sol` / `xhigh`. No-memory completed before
frozen-prehistory materialization, and both model calls completed before hidden
evaluator materialization. Both arms passed deterministic fail-to-pass and
pass-to-pass tests: 2 attempted, 2 finalized, 2 resolved, zero infrastructure
failures, one comparable pair, and outcome `tie-both-pass`. The tracked
projection under
`reports/quality-gates/phase-73/c3-controlled-20260716-cleanclone-003/`
contains 17 bound files. An independent verifier accepted internal consistency
and two clean-clone patch replays with no reasons. It records
`externalAuthenticityVerified: false`, so it does not authenticate the package,
raw run, or canary without an external CI artifact, signature, or transparency
root. The supplemental tracked source-reproducibility evidence under
`reports/quality-gates/phase-73/c3-controlled-20260716-cleanclone-003-source-reproducibility/`
contains a complete 4,891,617-byte Git bundle for runner commit
`fc31f4f96f3975daea361805da3fc4fc942c5aa4` / tree
`996b1c24bfb53a9d9c62eb109997576df7b512af`. Bundle SHA-256
`86aa767660b30fc9b6930c166c86cd9415d2e0083919e629abbdd9ef1d613ecb`
is bound to the original projection-manifest SHA-256
`1210f9908154af56b68c22f5235eff1a19824d009c2cd06a5ec9932b869f5008`.
The source verifier cloned only that bundle, checked the exact commit/tree and
clean status, then executed the bundled historical verifier; it again accepted
all 17 projected files and both clean-clone patch replays. This closes C3 source
reproducibility without treating the author-recovered bundle as an external
signature: `externalAuthenticityVerified` remains false. C3 proves protocol and
installed-host execution, not coding uplift. Phase 73 remains active with C6-C7
open.

### Phase C4: controlled pilot dataset

#### C4-T001: author six episodes

Minimum coverage:

- one open-loop handoff;
- one validated approach;
- one failure avoidance;
- one user correction;
- one stale update;
- one irrelevant-memory negative control.

Each episode has at least three stages.

#### C4-T002: fixture verification

- gold passes;
- base fails expected tests;
- three repeated base-health probes are stable;
- leakage audit passes;
- task author does not inspect A/B results before freezing the manifest.

#### C4-T003: dataset review

Independent review checks:

- tasks measure coding, not trivia;
- hidden tests are fair;
- memory is useful but not the answer;
- negative controls are credible;
- no repository-specific runner exception exists.

C4 acceptance:

- dataset manifest frozen and hashed;
- all episodes pass deterministic readiness;
- raw source licenses recorded.

C4 implementation status (2026-07-18): **V8 SUPERSEDED; V9 ACCEPTED; C5
INTERNAL PILOT UNBLOCKED**.
The schema-v2 fixture at
`fixtures/codex-coding-effect/c4-controlled-pilot/` freezes six independently
designed three-stage episodes across two dependency-free TypeScript
repositories. Its eight required memory strata cover open-loop handoff,
validated approach, failure avoidance, user correction, project convention,
stale update, irrelevant-memory control, and no-history control. The asset lock
closes 63 task, evaluator, repository, license, provenance, and manifest files.

The deterministic readiness gate ran three fresh base clones per stage (54
base probes total) and one fresh gold replay for each of the 18 stages. Every
base snapshot retained the same commit, tree, dependency state, expected
failure fingerprint, and semantic fingerprint across its three repetitions;
all 18 gold patches changed only the declared file and passed visible,
fail-to-pass, and pass-to-pass tests. License and author-attestation audits were
accepted. The full leakage audit derives typed scalar leaves and per-case
argument/expected-value relations from both fail-to-pass and pass-to-pass
cases, then evaluates every stage against the complete
surface-by-hidden-artifact matrix. The v9 detector preserves exact trim/case
endpoints and searches the full agent-visible corpus across whitespace,
sentence, line-count, byte-length, and physical-file boundaries. The frozen
manifest explicitly binds public pass-to-pass relations already present in
visible source; undeclared relations cannot evade detection by being split
across files. Projection envelope metadata is excluded
only from that surface's semantic hidden-value view, never from the episode
globally. The audit rejects the reproduced `docs/setup guide#intro`,
`2.5 -> 2_500`, hidden value `1` beside `schemaVersion: 1`, short
pass-to-pass leaks, `INFO -> invalid-level/false`, and numeric equivalents such
as `3,000`, `3e3`, and `62.50`. Gold replay stages every schema-declared path in
its isolated clone before capturing the canonical diff, covering added,
modified, deleted, and binary files. The frozen asset lock and deterministic
core contain 486 audited matrix cells and 1458 intentional mutation cells
across fragment, typed-value, and typed-relation injection channels. Of those
mutation cells, 648 are applicable and 810 are explicitly not applicable.
Four content-preserving dynamic surfaces remain mandatory live C5 re-audits:
`effective-codex-input-after-seeding`, `flat-summary-after-seeding`,
`goodmemory-export-after-seeding`, and
`goodmemory-hook-context-after-seeding`.

The historical independent review found one real fairness defect: the evaluator
required exact parse error codes that were not discoverable from the visible
repository. The visible source now publishes the error-code catalog and the
gold implementation consumes that same contract; hidden expected values were
not weakened. A separate determinism regression then caught an absolute
temporary path in the readiness core, which was removed by projecting only
`commit`, `id`, `tree`, and `url`. That review is no longer acceptance evidence
because subsequent leakage repairs changed the frozen core it bound.

The historical v1 no-memory ceiling pilot attempted and resolved 6/6 stage-3
tasks, correctly deciding `redesign-episodes-before-c5`. The later v7
schema-v2 baseline is also historical: it attempted 12 stages but had six
formal infrastructure failures, was `inconclusive`, and binds the replaced
asset lock. The current gate rejects its stage targets and asset identity.

The regenerated v8 dataset-only core remains deterministic at SHA-256
`6ec596c99891376842e612520ae00b00f627e99ba63f48b9a690f02c06c72d3a`
and binds asset lock
`a4db88c4dc9ebea7fc464ba104f34c3a0852e2743a798694723d9ae9614606c4`.
A new `fork-turns-none` reviewer inspected only the 63 frozen assets and
deterministic core, accepted all six episodes, and declared both coding outcome
flags false. Provenance SHA-256
`1eee28b3fb8f08b5f57dcfb74db62632682145f062d32cad93341c227f54c4dc`
binds dispatch, input bundle, request, and review response SHA-256
`cfa5b75dc8ad7bc30fc287f05dae113a6af3720e5b3ca806ba1487e38acbf44e`
while explicitly describing the orchestrator attestation as non-cryptographic.
The review completed before the current live outcome existed. The baseline projected
evidence verifier rejects finalized records whose process/test exit codes,
failure-event count/hash, timeouts, arm/permission evidence, evaluator timing,
forbidden/untracked files, base health, patch observations, or derived task
result disagree with the execution contract. Non-zero formal Codex errors are
retained as infrastructure evidence rather than converted into task failures.

C4 historical baseline `run-c4-baseline-v8-20260717T032532Z` completed all 12
planned no-memory stages with 2 resolved, 10 unresolved, zero infrastructure
failures, and no ceiling risk. Report SHA-256
`145075fe1db774e14fbce1ba6df6b6170c64cd87a9c81c89a7abb39aefcfb220`
recorded `proceed-to-c5-pilot` under v8. Final readiness SHA-256
`7cf3f8cb829472f34e475dddfe69911651887c2896559712988e1153b6ea0128`
bound the v8 frozen core, live baseline, independent review, and provenance.
Both artifacts are superseded. Canonical v9 baseline
`run-c4-baseline-v9-20260718T1815Z` has report SHA-256
`2140f020a5d3817d4b91a0d8edf5227db6fa7fec32995a6fab12df6d52901270`,
zero infrastructure failures, no ceiling risk, and decision
`proceed-to-c5-pilot`. Final readiness SHA-256
`3b24b4233faa6930d98c4de3d9bfea003ab09225c0eec0c7c81fb9c10869b2e2`
binds exact frozen prompt, repository commit/tree, evaluator commitments,
independent review, 12 projected stage records, and their 12 authenticated raw
sources in a repository-replayable bundle. C4 does not prove coding uplift,
but it unblocks the internal C5 pilot and authorizes no public claim.

### Phase C5: live pilot

Run:

- 6 episodes;
- 2 arms;
- 2 repetitions;
- all stages;
- randomized arm order.

This is 24 episode-arm runs. With the required minimum of three stages per
episode, it is at least 72 live stage runs. Stage and process counts are
reported separately.

Pilot questions:

- Are hook/integration failures near zero?
- Is the task set too easy or too hard?
- Does memory ever appear in the Codex trajectory?
- Are negative controls harmed?
- Is there a measurable rescue/regression signal?
- Is cost within a viable range?
- Which error categories need harness fixes versus product fixes?

Pilot output:

- internal report only;
- no README benchmark row;
- no public claim declaration;
- frozen failure corpus for deterministic regression tests.

C5 acceptance:

- every attempt accounted for;
- no silent fallback;
- failure taxonomy reviewed;
- power analysis and full-set budget produced.

C5 implementation status (2026-07-21): **INTERNAL PILOT ACCEPTED; PUBLIC
CODING-EFFECT CLAIM STILL INELIGIBLE**. The accepted v16 run used the following
zero-write readiness entrypoint before any live stage:

~~~bash
bun run prepare:codex-coding-effect:c5-pilot \
  --material-effect-pp=<predeclared-integer-1-to-50> \
  --order-seed=<positive-integer>
~~~

The internal-only live entrypoint was:

~~~bash
bun run eval:codex-coding-effect:c5-pilot -- \
  --package-tarball <goodmemory-package.tgz> \
  --run-id <fresh-run-id> \
  --codex-model <frozen-model> \
  --reasoning-effort <frozen-effort> \
  --material-effect-pp <same-predeclared-integer> \
  --order-seed <same-positive-integer>
~~~

The material-effect threshold is mandatory and becomes part of the frozen plan
before any live result exists. The plan fixes 6 episodes, 2 arms, 2
repetitions, all 3 canonical stages, balanced deterministic arm ordering, 24
longitudinal trajectories, 72 fresh Codex processes, native Stop writeback
only, and no frozen-prehistory seeding. A trajectory retains its isolated
GoodMemory storage and scope across stages while the repository returns to the
declared canonical snapshot and every stage gets a fresh Codex thread.

The coordinator revokes both copied model credentials before materializing a
stage evaluator, re-audits the four dynamic leakage surfaces, evaluates both
patches, and restores the copied credentials only when another stage remains.
Required-memory recall is bound to IDs committed by an earlier native Stop; a
required stage must recover at least one bound earlier ID, but selective recall
is not required to inject every prior record. A missing recall receipt or
unrecoverable exact hook context makes the pair incomparable and cannot fall
back to no-memory scoring. Raw hook context and
memory export stay in process only. Persisted canary evidence contains redacted
rollout messages, IDs, and hashes. Stage and pair rows append immediately to
their JSONL ledgers. Every stage row binds its sanitized execution evidence by
SHA-256, and every arm evaluation binds its sanitized evaluator evidence by
SHA-256; a plausible-looking result without those digests is rejected.

The real adapter copies and revalidates the asset-locked C4 dataset before
exposing any trajectory callback, materializes the two controlled source
repositories, installs one isolated runtime per longitudinal arm trajectory,
and keeps that runtime and GoodMemory storage across stages. It resets the same
trajectory workspace to each declared snapshot, starts a new non-resumed Codex
process, captures the patch, and collects the exact installed-host canary. Both
copied model credentials are removed before the live leakage audit and before
the evaluator source is copied into isolated evaluator sandboxes. The adapter
also freezes the Codex executable/version and packaged GoodMemory identity
across clusters and persists per-cluster host preflight evidence before the
first stage runs.
Before creating output, both the programmatic runner and CLI reject any mutable
output, runtime, source, or workspace root that overlaps the frozen dataset,
C4 evidence, source credential, package artifact, or runner checkout.
An append-only event stream records dataset validation, trajectory preparation,
stage lifecycle, credential revocation/restoration, leakage audit, evaluation,
cleanup, completion, and hashed failure diagnostics as the long chain runs.

The internal report requires all 72 stage identities and all 36 pair identities,
retains every infrastructure, memory-channel, task, and incomparability reason,
and keeps `publicClaimEligible`, `publicCodingEffectProof`, and
`readmeRowAllowed` false. Its planning calculation uses a conservative 0.5
discordance rate, 5% two-sided alpha, 80% power, and the pilot-estimated
within-episode correlation as a design effect. The report executes the
predeclared 10,000-sample paired percentile bootstrap with episode as the
resampling unit, aggregates Codex input/output/cached-token and duration usage,
and reports native injection, required-recall, writeback, irrelevant-injection,
and missing-observation counts. Dollar cost stays null until a model-price
snapshot is frozen. The resulting C6 budget cannot
fall below 30 episodes, 90 distinct scored stages, 6 repositories, 3 order
seeds, or 540 Codex calls.

The earlier six-process lifecycle diagnostic canary remains rejected because
live evidence disproved its exact-equality prior-memory rule and its source
identity was later invalidated. It was not reused. Accepted run
`run-c5-pilot-v16-20260721T150112Z` instead completed 72/72 scheduled Codex
stages, 36/36 pairs, and 12/12 cluster commits. Thirty pairs were comparable:
GoodMemory resolved 28/30 versus 12/30 for no-memory, with 16 rescues, zero
regressions, and a 0.2667-0.6667 paired episode-cluster bootstrap interval for
the 0.5333 net-rescue rate. Six host-canary infrastructure failures and six
memory-channel failures are retained in the failure taxonomy, and the affected
pairs remain incomparable.

The independent verifier accepted 395 sanitized files and disclosed 36
process-only Codex JSONL trajectory-origin receipts. It independently
recomputed prompt and patch origins, validated the opaque receipts' canonical
IDs, digests, matrix integrity, frozen-artifact invariants, candidate claims,
and surface bindings, but did not claim access to their redacted content
preimages. Therefore `externalAuthenticityVerified` remains false. A fresh
`fork-turns-none` reviewer accepted the five C5 assertions with this
authenticity boundary as an advisory; reviewer/author provenance and the final
accepted gate are tracked under
`reports/quality-gates/phase-73/c5-native-longitudinal-pilot-v16/`.

The pilot is a positive internal controlled signal and produces a C6 minimum
budget of 113 episodes, 339 scored stages, 6 repositories, 3 seeds, and 2034
Codex calls. It does not close C6/C7 and cannot create a README benchmark row:
`publicClaimEligible`, `publicCodingEffectProof`, and `readmeRowAllowed` remain
false.

### Phase C6: expanded dataset and full run

#### C6-T001: expand/finalize dataset

- meet minimum episode/repository/language counts;
- add real-history or continuously refreshed tasks;
- keep controlled mutation strata;
- freeze a claim-candidate manifest.

#### C6-T002: add flat-summary arm

- fixed summary model/prompt;
- equal maximum injected token budget;
- history source hash equality;
- cost recorded.

#### C6-T003: package-isolated reproducibility

- build package/tarball once;
- hash it;
- install only that artifact in every arm;
- run on a pinned Linux x86_64 environment for the final claim;
- keep Mac native runs as separate diagnostic evidence.

#### C6-T004: execute three seeds

- interleave paired arms;
- cap concurrency to avoid provider/CPU contention;
- retain all attempts;
- stop the whole run on identity or dataset drift.

C6 acceptance:

- complete paired artifacts;
- zero unresolved infrastructure failures;
- three seeds;
- power requirement met;
- summary generated without reading raw gold patches.

### Phase C7: gate and claim promotion

#### C7-T001: gate implementation

Write failing tests for every gate criterion and claim boundary.

#### C7-T002: reproducibility rerun

A separate clean environment reproduces:

- dataset selection;
- package hash;
- a predeclared subset or full run;
- summary calculations;
- gate decision.

#### C7-T003: docs and public claim

Only after gate acceptance:

- add a benchmark claim declaration;
- add the narrow README row;
- link accepted gate;
- disclose Codex/model/config/dataset limitations;
- keep pilot and diagnostic numbers out of the public row.

C7 acceptance:

- gate artifact tracked;
- release tests enforce declaration/report consistency;
- public wording matches claim-boundary.json exactly.

## 17. Gate Criteria

### 17.1 Harness integrity gate

All must pass:

- dataset and leakage audit valid;
- paired arm identity valid;
- no output/source path collision;
- every selected stage has a finalized result;
- every attempt retained;
- package/Codex/config hashes present;
- raw-to-normalized trace indexes valid;
- no hidden test/gold leakage;
- no unresolved infrastructure failure.

### 17.2 Host gate

For every GoodMemory stage:

- expected hooks registered;
- hooks feature enabled;
- injection decision recorded;
- Stop outcome recorded;
- writeback ledger outcome recorded;
- no silent manual-rollout fallback;
- no cross-arm memory scope;
- no raw transcript persisted contrary to profile.

### 17.3 Performance gate

Predeclared first candidate thresholds:

- positions-two-and-later resolve@1 delta versus no-memory is at least +5.0
  percentage points;
- paired 95% episode-clustered bootstrap interval lower bound is greater than 0;
- rescue count exceeds regression count;
- episode completion delta is non-negative;
- pass-to-pass regression rate is not worse than baseline by more than 2.0
  percentage points;
- stale-update/correction safety pass rate is at least 95%;
- irrelevant/no-history negative-control resolve rate is non-inferior within
  2.0 percentage points;
- GoodMemory hook/writeback success is 100% for finalized GoodMemory stages;
- all cost and latency metrics are present.

The pilot may cause these thresholds to be revised once, before the full
claim-candidate manifest is frozen. After freeze, thresholds cannot move in
response to results.

### 17.4 Strong-control gate

Before claiming that GoodMemory is better than ordinary context carry-forward:

- both arms must respect the same maximum injected token budget;
- summary generation cost must be included;
- an accuracy-superiority claim requires at least +3.0 percentage points versus
  flat-summary and a paired episode-clustered 95% interval lower bound above 0;
- a cost-efficiency claim may instead use a predeclared 2.0-point
  non-inferiority margin, but must show at least 20% lower total cost per
  resolved stage and cannot be worded as accuracy superiority.

If GoodMemory only beats no-memory but not flat-summary, the allowed claim is:

> Durable historical context improves Codex outcomes under this protocol.

It is not:

> GoodMemory's memory policy is superior.

The basic GoodMemory-versus-no-memory Codex product claim may still be reported
when its own gate passes, but the flat-summary result must be disclosed next to
it.

## 18. Failure Taxonomy

### 18.1 Infrastructure failures

- preflight;
- dataset;
- workspace preparation;
- package installation;
- Codex launch;
- hook registration;
- injection transport;
- Stop/transcript hydration;
- GoodMemory storage;
- provider transport before task execution;
- test harness startup;
- artifact persistence;
- identity/resume.

### 18.2 Task failures

- no patch;
- wrong patch;
- visible tests fail;
- hidden fail-to-pass tests fail;
- protection regression;
- forbidden file change;
- timeout during agent work;
- repeated failed approach;
- ignored correction;
- stale-memory action;
- irrelevant-memory distraction.

### 18.3 Diagnostic labels

Task failures may carry non-exclusive labels:

- localization;
- code comprehension;
- implementation;
- test/debug loop;
- environment/tooling;
- instruction compliance;
- memory miss;
- memory noise;
- memory stale;
- memory contradiction;
- memory not used;
- answer says success but tests fail.

Labels are diagnostic. The deterministic resolved boolean remains authoritative.

## 19. Security, Privacy, and Licensing

### 19.1 Credentials

- inject model credentials only into the Codex process that needs them;
- do not expose credentials to dependency installation;
- remove credentials before hidden tests;
- never persist auth files in reports;
- redact environment output;
- use isolated temporary homes;
- disable ambient Git credentials.

### 19.2 Prompt injection and untrusted repositories

Repositories are untrusted input:

- final runs execute in external isolation;
- no write token;
- restricted network;
- no access to sibling directories;
- package lifecycle scripts run before credentials enter;
- hidden tests execute without model credentials.

### 19.3 Transcript handling

- raw Codex event/transcript artifacts remain local and gitignored by default;
- tracked artifacts store hashes and sanitized excerpts only;
- writeback profile keeps raw transcript persistence disabled;
- dataset authors confirm that prompts/history contain no private user data.

### 19.4 Licenses

For every source repository and task:

- record code license;
- record dataset/task license;
- record whether patches/log excerpts can be redistributed;
- do not track source corpora when the license forbids it;
- publish manifests and hashes instead of vendoring restricted data.

## 20. Cost and Execution Strategy

### 20.1 Pilot

The pilot optimizes for finding harness defects, not statistical significance:

- concurrency 1 or 2;
- interleaved paired arms;
- two repetitions;
- detailed traces retained;
- stop early on systematic hook or fixture failure.

### 20.2 Full run

- estimate cost from pilot p50/p95 per-stage usage;
- predeclare total budget;
- cap concurrency below provider and local CPU saturation;
- avoid overlapping other live GoodMemory evals;
- checkpoint every finalized stage;
- never change concurrency or model mid-run without a new run identity.

### 20.3 Cost reporting

Report:

- Codex usage/cost when available;
- GoodMemory extraction/embedding/reranking usage;
- flat-summary generation usage;
- total cost per arm;
- cost per resolved stage;
- incremental cost per additional rescue;
- p50/p95 latency.

An accuracy gain with extreme unreported cost is not a product proof.

## 21. Documentation and Repository Integration

During implementation:

1. Add this document to docs/README.md.
2. Add a compact task-board phase only when implementation starts.
3. Keep task-board/00-README.txt as the execution router.
4. Keep detailed task mechanics here, not in AGENTS.md.
5. Update GoodMemory-Current-Status-and-Evidence.md only when evidence state
   changes.
6. Do not add a README benchmark row before accepted gate evidence.
7. Add release tests for the claim declaration and report hashes only after the
   full gate exists.

Recommended future task-board title:

Phase 73: Codex Installed-Host Coding Effect Evaluation

Do not reuse the Phase 72 MemGym gate as the coding-effect gate. Phase 72 can
close its memory/generalization and v0.6 release scope honestly while this lane
builds direct coding evidence.

## 22. Claude Code Deferral Boundary

Claude Code begins only after:

- Codex native hook canary passes;
- deterministic harness passes;
- Codex pilot completes;
- Codex failure taxonomy is stable;
- Codex claim-candidate protocol is frozen.

Deferred Claude work includes:

- Claude CLI executor;
- Claude stream-json normalizer;
- Claude hook canary;
- Claude-specific isolated config;
- separate model/config stratum;
- separate claim and gate.

When Claude starts, do not compare its absolute score to Codex. Measure:

- Claude no-memory versus Claude GoodMemory;
- Codex no-memory versus Codex GoodMemory.

Only then consider a cross-host statement such as:

> GoodMemory produced positive paired uplift on two independently evaluated
> installed coding hosts.

## 23. What Not To Build

Do not build:

- a benchmark DSL;
- a plugin framework for task types;
- a generic workflow engine;
- a universal test parser for every ecosystem;
- an LLM judge that can override hidden tests;
- a dashboard before reports are stable;
- a cloud execution service;
- automatic benchmark task generation without human validation;
- a compatibility layer for every historical Codex transcript format;
- a second GoodMemory runtime inside the eval runner.

Use manifest data, small TypeScript modules, explicit subprocess boundaries, and
JSON artifacts.

## 24. Definition of Done

The Codex-first project is complete only when all are true:

### Design and contracts

- [ ] Evidence classes are explicit.
- [ ] Claim wording is frozen before full execution.
- [ ] Dataset schema and leakage rules are tested.
- [ ] No-memory, GoodMemory, and flat-summary arms are specified.
- [ ] Primary and secondary metrics are frozen.
- [ ] Gate thresholds are frozen.

### Host correctness

- [ ] Current Codex native hooks are detected.
- [ ] Native injection is proved.
- [ ] Native Stop writeback is proved.
- [ ] Transcript drift fails visibly.
- [ ] GoodMemory status/audit uses packaged public surfaces.
- [ ] Cross-arm homes/scopes cannot collide.

### Coding evaluation

- [ ] Real Codex edits real repositories.
- [ ] Every stage starts a fresh Codex session.
- [ ] Hidden tests run outside Codex.
- [ ] Protection regressions are scored.
- [ ] Patches and test results are hashed.
- [ ] Task failures stay in the denominator.

### Evidence integrity

- [ ] Run identity is written before live calls.
- [ ] Resume rejects drift.
- [ ] Attempts remain append-only.
- [ ] Raw and normalized traces are linked.
- [ ] Every selected pair is complete.
- [ ] Unresolved infrastructure failures are zero.
- [ ] All source licenses and versions are disclosed.

### Statistical and product proof

- [ ] Minimum dataset and power requirements are met.
- [ ] Three execution-order seeds complete.
- [ ] Per-stratum results are reported.
- [ ] Rescue and regression counts are reported.
- [ ] Clustered confidence interval passes.
- [ ] Negative-control and stale-memory safety gates pass.
- [ ] Cost per resolved task is reported.
- [ ] Flat-summary comparison is complete.

### Public promotion

- [ ] Accepted gate artifact is tracked.
- [ ] Claim boundary is claimable.
- [ ] Reproducibility rerun passes.
- [ ] README wording is narrow and exact.
- [ ] Claim says Codex only.
- [ ] MemGym CodeQA remains a separate mechanism claim.

## 25. Design Inputs and External References

This plan is grounded in the following current repository and external
contracts:

- [GoodMemory Current Status and Evidence](../GoodMemory-Current-Status-and-Evidence.md)
  for shipped surface, active phase, and claim boundaries.
- [GoodMemory First Principles and Reference Architecture](../GoodMemory-First-Principles-and-Reference-Architecture.md)
  for the coding-agent continuity thesis and runtime/durable-memory separation.
- [GoodMemory TDD and Evaluation Strategy](../GoodMemory-TDD-and-Evaluation-Strategy.md)
  for paired baseline design, traces, failure artifacts, and deterministic
  assertions.
- [GoodMemory Codex Handoff Setup Guide](../GoodMemory-Codex-Handoff-Setup-Guide.md)
  for the installed package surface.
- [OpenAI Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)
  for codex exec, JSONL events, explicit sandboxing, and automation behavior.
- [OpenAI Codex hooks](https://developers.openai.com/codex/hooks)
  for SessionStart, UserPromptSubmit, Stop, transcript_path, and additional
  context contracts.
- [SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/)
  for fail-to-pass and pass-to-pass patch correctness.
- [SWE-rebench](https://papers.neurips.cc/paper_files/paper/2025/hash/21bec6ace947b1b58967b945c8ac0f10-Abstract-Datasets_and_Benchmarks_Track.html)
  for continuously collected, contamination-aware software-engineering tasks.
- [MemGym](https://arxiv.org/html/2605.20833) for the distinction between
  memory-isolated CodeQA and executable SWE-Gym outcomes.
- [Structurally Aligned Subtask-Level Memory](https://arxiv.org/html/2602.21611)
  for budget-neutral streaming evaluation, multiple shuffled task orders, and
  patch-level Pass@1 measurement.

External papers are design inputs, not proof that GoodMemory itself improves
Codex. Only this repository's accepted host-native gate can establish that
claim.

## Appendix A. Episode Manifest Sketch

~~~json
{
  "schemaVersion": 1,
  "datasetId": "codex-coding-continuity-pilot-v1",
  "episodes": [
    {
      "id": "episode-example-001",
      "claimEligibility": "pilot-only",
      "sourceType": "controlled-mutation",
      "stateMode": "canonical-snapshot",
      "strata": ["failure-avoidance", "user-correction"],
      "repository": {
        "url": "https://example.invalid/repository",
        "license": "MIT",
        "baseCommit": "<sha>"
      },
      "preparation": {
        "command": ["bun", "install", "--frozen-lockfile"],
        "networkMode": "dependency-setup-only"
      },
      "prehistory": {
        "path": "prehistory/episode-example-001.jsonl",
        "sha256": "<sha256>",
        "forbiddenLeakageSha256": ["<gold-patch-sha256>"]
      },
      "stages": [
        {
          "id": "stage-1",
          "position": 1,
          "snapshot": "<sha>",
          "promptPath": "prompts/episode-example-001-stage-1.md",
          "visibleTest": ["bun", "test", "tests/visible.test.ts"],
          "hiddenFailToPass": ["bun", "test", "<external-hidden-test-path>"],
          "hiddenPassToPass": ["bun", "test", "tests/regression.test.ts"],
          "timeoutMs": 900000,
          "expectedMemoryDependencies": []
        },
        {
          "id": "stage-2",
          "position": 2,
          "snapshot": "<sha>",
          "promptPath": "prompts/episode-example-001-stage-2.md",
          "hiddenFailToPass": ["bun", "test", "<external-hidden-test-path>"],
          "hiddenPassToPass": ["bun", "test", "tests/regression.test.ts"],
          "timeoutMs": 900000,
          "expectedMemoryDependencies": [
            {
              "category": "failure-avoidance",
              "description": "Do not repeat the previously disproved approach"
            }
          ]
        }
      ]
    }
  ]
}
~~~

The real schema should use Zod and strict path/provenance validation. This sketch
is explanatory, not an implementation contract.

## Appendix B. Stage Result Sketch

~~~json
{
  "schemaVersion": 1,
  "runId": "<run-id>",
  "episodeId": "episode-example-001",
  "stageId": "stage-2",
  "arm": "goodmemory-installed",
  "seed": 1,
  "repetition": 1,
  "attemptId": "<attempt-id>",
  "codex": {
    "version": "<version>",
    "model": "<model>",
    "exitCode": 0,
    "timedOut": false,
    "usage": {}
  },
  "hostCanary": {
    "hooksLoaded": true,
    "injectionDecision": "injected",
    "stopObserved": true,
    "writebackOutcome": "written"
  },
  "patch": {
    "sha256": "<sha256>",
    "changedFiles": ["src/example.ts"]
  },
  "tests": {
    "failToPass": "passed",
    "passToPass": "passed"
  },
  "resolved": true,
  "executionFailureStage": null,
  "taskFailureReasons": [],
  "artifacts": {}
}
~~~

## Appendix C. Expected Developer Commands

Deterministic development loop:

~~~text
bun test tests/unit/codex-coding-effect.*.test.ts
bun test tests/integration/codex-coding-effect.*.test.ts
bun run typecheck
~~~

Dry-run:

~~~text
bun run eval:codex-coding-effect:smoke -- \
  --dataset-root <path> \
  --run-id <run-id> \
  --dry-run
~~~

Native canary:

~~~text
bun run eval:codex-coding-effect:canary -- \
  --package-tarball <path> \
  --run-id <run-id>
~~~

Tracked C2 projection from a copied raw run root:

~~~text
bun run project:codex-coding-effect:c2-evidence -- \
  --run-root <path>
~~~

Pilot:

~~~text
bun run eval:codex-coding-effect:pilot -- \
  --dataset-root <path> \
  --arm no-memory \
  --arm goodmemory-installed \
  --seed 1 \
  --repetition-count 2 \
  --run-id <run-id>
~~~

Full candidate:

~~~text
bun run eval:codex-coding-effect:full -- \
  --dataset-root <path> \
  --arm no-memory \
  --arm flat-summary \
  --arm goodmemory-installed \
  --seed 1 \
  --seed 2 \
  --seed 3 \
  --package-tarball <path> \
  --run-id <run-id>
~~~

Gate:

~~~text
bun run gate:codex-coding-effect -- \
  --report <summary.json> \
  --run-id <gate-run-id>
~~~

Command names remain proposed until implementation tests and package scripts
land.

## Appendix D. Allowed Public Wording

Allowed after acceptance:

> On the frozen <dataset> evaluation using Codex CLI <version>, model <model>,
> and the declared installed-host profile, GoodMemory improved positions-two-
> and-later hidden-test resolve@1 from <baseline> to <goodmemory> (<delta>
> percentage points, paired episode-clustered 95% CI <interval>) across
> <episode-count> episodes and <stage-count> stages, with zero unresolved
> infrastructure failures.

Required adjacent disclosures:

- no-memory and flat-summary results;
- rescue/regression counts;
- cost and latency;
- dataset composition;
- repository licenses;
- Codex/model/config version;
- GoodMemory provider profile;
- negative-control and stale-memory results;
- accepted gate link.

Forbidden wording:

- GoodMemory makes AI code better in general.
- GoodMemory improves all coding agents.
- GoodMemory improves Claude Code.
- GoodMemory improves model intelligence.
- MemGym proves Codex writes better patches.
- The result is state of the art unless an external comparable protocol supports
  that exact statement.
