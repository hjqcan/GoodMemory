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

- uses the same frozen stage-history binding as GoodMemory;
- summary is generated once per distinct stage-history binding before arm
  execution and reused across seeds;
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
- at least 6 repositories as a pilot-era diversity floor, not a repository-
  inference sufficiency claim;
- at least 2 programming-language ecosystems;
- primary coding cohort uses real-history and external-benchmark tasks;
- controlled mutations are a separate diagnostic registry and never enter the
  primary schedule;
- three execution-order seeds;
- public-source licenses and immutable repository commits.

#### Level 3: public claim set

The final episode floor is selected after the pilot using the observed paired-
discordance rate. The final repository-family count and allocation are selected
from outcome-blind repository power/precision evidence before candidate
freeze. Repeated seeds do not magically create independent episodes, and
repeated episodes do not magically create independent repositories. Claim
intervals resample repository families and then episodes.

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

### 11.6 Confidence intervals and repository inference

The primary point estimand gives every episode equal weight. First average all
complete seed and eligible-stage cells inside one episode, compute its paired
arm delta, then average those episode deltas.

The former episode-only paired bootstrap remains a 10,000-sample, 95%
percentile diagnostic. It is not sufficient for a coding-effect claim because
episodes from one repository may be correlated.

The claim gate uses a separately seeded 10,000-sample hierarchical bootstrap:

- freeze `canonical-upstream-repository-family-v1` before outcomes exist;
- resample repository families with replacement;
- inside each sampled family, resample its episodes with replacement;
- preserve every selected episode's paired arms, seeds, and eligible stages;
- report both the episode-weighted statistic and the equal-repository
  statistic with 95% percentile intervals;
- report every leave-one-repository-out episode-weighted delta, the minimum
  delta, maximum absolute shift, and sign-flip count;
- report the raw paired discordance table and McNemar's test only as
  diagnostics;
- do not treat more episodes from the same repositories as replacement for
  independent repository evidence.

Repository renames, redirects, related forks, and controlled variants sharing
one upstream lineage belong to one reviewed family. The same repository URL
may never be split across family identifiers.

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
- at least 6 repositories as a diversity diagnostic;
- at least three execution-order seeds.

If episode- or repository-level power/precision analysis requires more, the
larger requirement wins. Without accepted between-repository evidence, the
repository requirement is `not_evaluable` and full execution remains blocked.

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
snapshot is frozen. As historical C5 planning evidence, that report rejected a
budget below 30 episodes, 90 distinct scored stages, 6 repositories, 3 order
seeds, or 810 three-arm Codex stage calls. Those were pilot-era safety floors,
not the final C6 headline power result.

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

The pilot is a positive internal controlled signal. Its tracked report produced
an all-three-stage planning result of 113 episodes, 339 scored stages, 6
repositories, 3 seeds, and 2034 no-memory-plus-GoodMemory calls. That result is
retained as C5 provenance, but it is not a valid C6 headline budget because the
C6 estimand excludes execution position 1 and scores only positions two and
later. The tracked five-file C5 prerequisite does not contain a separately
verified eligible-position correlation estimate. Reusing the all-stage
correlation of 0.2 would yield a mechanical 131-episode correction, but C6 does
not accept that estimate as power evidence.

The current C6 checkpoint therefore fails closed with worst-case
within-episode correlation 1.0. C5's 391 paired observations before clustering,
six headline observations per episode (two eligible positions across three
seeds), and a worst-case design effect of six yield
`ceil(391 * 6 / 6) = 391` episodes. With three stages per episode, the
conservative minimum is 1173 scored stages, 7038 no-memory-plus-GoodMemory
Codex stage calls (`1173 * 3 * 2`), 10557 total three-arm Codex stage calls
(`1173 * 3 * 3`), and at most 1173 one-time stage-history summary-generation
calls. An identical stage-history hash may reuse one summary, but distinct
growing prefixes may not share an episode-level summary. This is a
`minimumEpisodeFloor`, not a sufficient final sample size: it corrects only
within-episode repeated observations and does not estimate
between-repository heterogeneity. The final repository-family count and
allocation must come from a freeze-time, outcome-blind, independently reviewed
repository power/precision artifact. If C5 cannot support that estimate, the
repository-level requirement is `not_evaluable`; the old six-repository pilot
floor cannot be promoted into a sufficiency claim. None of these planning numbers closes
C6/C7 or creates a README benchmark row: `publicClaimEligible`,
`publicCodingEffectProof`, and `readmeRowAllowed` remain false.

The tracked deterministic eligible-position recalculation is now schema v2 at
`fixtures/codex-coding-effect/c6-source-pool/c5-v16.eligible-position-power-adjustment-v2.json`,
SHA-256
`7c0ce1f26af3540fc84359db10500e9e9bc04b4186e80a87ca3bbc3174ac4b72`.
It binds the exact C5 v16 report planning inputs (`alpha = 0.05`,
`power = 0.8`, material effect `0.1`, planning discordance `0.5`, and 391
pre-clustering paired observations), plan, pair ledger, attempt ledger, stage
executions, and projection manifest. It validates position 1 as `none` and
positions 2 and later as explicit required/irrelevant-control memory
expectations before deriving 24 eligible pairs, 20 comparable pairs, five
complete comparable episodes, ICC 1, design effect 6, and the same 391-episode
floor. The real frozen-input and review-receipt suite passes 7/7 focused tests
with 20 assertions. A fresh `fork-turns-none`, read-only reviewer independently
replayed all six inputs and returned `ACCEPT_WITH_BOUNDARIES`, with no P0-P2.
Its only P3, a v1 filename carrying schema v2, was closed by a byte-preserving
rename; the artifact SHA remained unchanged. The separate review receipt is
SHA-256
`3f8292aba907acf947148c925d61e7698312177f25fdf521b634106efbafd918`.
The reviewed artifact retains its immutable pre-review `pending` field, while
the later receipt records the decision without rewriting reviewed bytes. The
receipt is not cryptographically authenticated, and neither file supports a
floor reduction, candidate-capacity assertion, C6 outcome inference, or public
claim.

### Phase C6: expanded dataset and full run

#### C6 implementation checkpoint: deterministic preflight, not final freeze

The current C6 implementation increment is the deterministic checkpoint that
must pass before a candidate manifest can be frozen or any summary-provider or
Codex call can begin:

- `c6-asset-lock.ts` rejects symlinks in the dataset root or any lexical
  ancestor, recursively binds every regular candidate asset through a
  non-following file handle, includes executable mode in the closure, and
  revalidates the entire asset closure at the end of preflight so byte, mode,
  path-component, or during-preflight drift fails closed;
- `c6-readiness.ts` accepts only the exact tracked C5 v16 gate, verification,
  report, independent review, and reviewer provenance hashes; rejects
  symlinked substitutes; and derives the conservative headline budget rather
  than copying the C5 headline number;
- `c6-package.ts` accepts only a structurally valid gzip archive with the
  declared `goodmemory` name/version, required CLI/MCP/host entry paths, a
  unique contained file closure, and stable bytes before and after inspection;
  this is deliberately structure-only and does not prove source origin or
  runtime behavior;
- `c6-package-closure.ts` cross-checks an externally frozen asset/root,
  closure manifest, consumer lock, offline tarball set, installed-tree
  manifest/archive, and declared Linux runtime profile. It rejects unsafe
  tar entries, dependency-graph gaps, and self-consistent closure
  substitution, but deliberately returns
  `buildReceiptValidation: declared-profile-structure-only` and
  `linuxRebuildProven: false` when replaying a persisted receipt without a live
  executor;
- `c6-package-closure-materializer.ts` has now completed two live fresh-root
  materializations in the pinned Linux/amd64 image. Each run acquires an exact
  dependency set separately, installs from an empty seeded cache with
  `npm ci --offline` under `network=none`, repeats the install, rebuilds from
  the frozen closure in a second network-none container, and runs read-only
  version/help smoke. Both 124-file, 57233374-byte outputs are byte-identical:
  expected identity
  `770d7a80938a62c86914e863e639c20e63358fc0fc56afb99f2823f212179c30`,
  installed tree
  `c73a5db06353bd0dc8c0a31e2a3837e8636eca6e4d59f221df338b1acf0dc3eb`,
  and Linux receipt
  `7be421af8a9a6823e66573e57abe3927c0e012d1976f75dd2789e31c5d2796e1`.
  The tracked 1173473-byte projection is bound by
  `two-run-reproducibility.json` SHA-256
  `3a066d1e841f9902bb499a60715feba3bbac6cc9feca0bf3d376e7503d6ab0cd`.
  The full roots remain external and independent replay is required;
  persisted verification deliberately cannot promote a self-reported receipt
  to live execution proof;
- the earlier exact-source run for commit
  `5d6dab3bf8b406455068c01863c5cbd51cf65756` / tree
  `8563c9136864430772e024925811be55402f3372` remains a useful networked
  diagnostic only. It produced the expected package, but correctly retained
  false offline-closure and external-attestation fields;
- `c6-package-source-reproducibility.ts` has since completed two same-host
  builds of that exact source in fresh pinned Linux/amd64, network-none
  containers from two independently materialized copies of one frozen
  dev-dependency closure. Both installed 292 dependencies and produced the
  same 1035700-byte package at
  `5f9b98600ff024a80a7a337fa8953e162b7498bf909a67e8b217a9bba5dd2757`.
  The external nine-file closure is
  `/private/tmp/goodmemory-c6-package-source-offline-v3-sync-v1`; its v3
  receipt SHA-256 is
  `21599cb09660c944cf759a6f97e1e9ed1cb15ca35d619b088c104d92c5deb732`,
  runner-source root is
  `047e3939016d0ba646139354edad44902008183f8e0d3078ed0ab104547f4826`,
  and the explicit external-root Phase-73 gate passes 2/2 with 14 assertions.
  Its dependency-cache scanner now uses exact synchronous FD reads with an
  actively checked monotonic deadline on every chunk and unconditional FD
  closure; the focused mutation/termination suite passes 11/11 with 141
  assertions. This hardens scanner termination and TOCTOU detection only.
  This proves a locally observed, two-run offline source build plus static
  replay of the retained closure. The receipt deliberately keeps
  `sourceBuildReproducible: false`,
  `c6PackageOfflineClosureProven: false`,
  `executionAuthenticated: false`,
  `externalIndependentAttestation: false`, and
  `rawExecutionWitnessIncluded: false`; authenticated source-to-archive proof
  and the final installed-host profile remain open;
- the retained v3 receipt is not a current-tree gate pass. It pins runner
  source root
  `047e3939016d0ba646139354edad44902008183f8e0d3078ed0ab104547f4826`,
  while the present nine-file runner closure rebuilds as
  `39cc7f153b2e532d9d4a2179d20d2dfc8704dee9fb05c3581ddc44c52e9d62bf`.
  Package bytes remain equal, but the source/verifier proof chain has drifted.
  The expected root must not be patched in place; a fresh two-run receipt is
  required after runner-source freeze. In the current Git snapshot the
  C6-T003 materializers, gates, and projections are worktree-only rather than
  landed or staged evidence;
- `c6-codex-runtime-linux.ts` has now materialized the exact
  `@openai/codex@0.145.0` package closure twice in fresh, read-only,
  network-none Linux/amd64 containers. Both runs reached
  `codex-cli 0.145.0` and produced the same 8339-byte artifact at SHA-256
  `31dc6b7ca5babf01d6bcff7e012a63aaf12f1e1141b4e44dfea7ea01e997463b`;
  installed-tree SHA-256 is
  `f4dd92f92e35501f547e76be3e9f916d4b701ac28d78a533c89337dcd0d4e39a`.
  Receipt SHA-256
  `c5301d9ae73447b9ab78ba3e4c2575dd76c831af6701244e00db5602ea9fc0df`
  binds the exact input, Docker CLI/socket/image authority, two artifacts,
  frozen runner sources, executable bytes/modes, manifest, and asset root.
  The explicit Phase-73 gate verifies the retained closure and optionally
  revalidates it against the external tarball root. The materializer directly
  observed both live installs, while persisted verification deliberately
  returns `linuxOfflineInstallProven: false` and `codexRunReady: false`
  because self-reported JSON is not an authenticated execution witness. This
  completes the Codex package-install materialization prerequisite, not the
  installed-host configuration, treatment-injection profile, or C6 run;
- `c6-candidate-plan.ts` schema v7 admits only the primary coding cohort and
  binds the executable adjacent-task relationship closure:
  exactly 391 claim-eligible `real-history` or `external-benchmark` episodes,
  exactly three stages per episode and 1173 scored stages, at least 6
  repositories, at least 2 ecosystems,
  at least 48 `real-history` episodes, complete memory strata, and at least 48
  exclusive `primaryStratum` episodes per stratum. It rejects any
  `controlled-mutation` row in the primary candidate dataset; those rows belong
  to a separately reported diagnostic registry and never enter the 10,557-call
  headline schedule. It rejects an enlarged C5 budget declaration as well as
  an oversized candidate dataset so the advertised process count cannot drift
  to 10,566 or 10,584. Controlled-mutation counts were removed from the
  candidate-plan output because no diagnostic registry is consumed there. It
  also rejects a
  primary stratum absent from actual positions-two-and-later expectations,
  negative-control mode/category mismatch, duplicate locked
  repository content roots, duplicate agent-visible repository-plus-ordered-
  prompt fingerprints, non-frozen prehistory, a `real-history` label without a
  strict asset-locked source record and review-receipt structure, unreviewed
  redistribution, missing
  asset-locked repository paths,
  non-Linux/x64 execution, package/environment/runner identity gaps, or
  anything other than three distinct positive seeds;
- `c6-dataset-lineage.ts` requires the C6 manifest to bind one canonical
  dataset-lineage artifact. That artifact pins each source snapshot revision,
  its population-manifest hash, normalized source-record JSONL bytes, per-row
  index/hash, and source-license review structure. It binds every episode's
  agent-visible task fingerprint, prehistory unit list/materialization receipt,
  and ordered stage target to repository, prompt, snapshot, source request,
  locator, source-snapshot revision, upstream-item revision, and record bytes.
  For every ordered real-history target, the reviewed task-origin locator,
  `ecmascript-string-trim-v1` original-request hash, and upstream-item revision
  must all agree with the normalized record. It rejects reused target units,
  record bytes, locators, or target aliases in candidate prehistory. The
  candidate plan transitively binds the lineage hash and per-episode stage
  targets. This is asset-bound normalized-record consistency, not proof that
  the local capture is authentic upstream or that an issue relationship is
  semantically memory-dependent;
- `c6-episode-intake-review.ts` schema v2 validates an asset-bound five-file
  review envelope, the caller-reconstructed candidate universe, canonical
  origin anchors, semantic-family partition, and deterministic
  representatives. Every representative must be `selected` or
  `qualified-reserve`; every non-representative must be
  `semantic-duplicate`; the selected IDs must equal the final dataset IDs and
  the reserve set must be complete. It deliberately returns
  `selectionClosureRebuilt: false`,
  `sourceIntakeClosureRebuilt: false`, and `cryptographicReceipt: false`; it
  cannot be accepted intake proof until an independent verifier reconstructs
  the complete source universe and selection closure;
- `c6-leakage.ts` merges every stage's hidden cases and gold artifacts at the
  episode level, then applies the complete matrix to every stage's prehistory,
  feedback, prompt, repository-visible files, the flat-summary prompt, and
  summary output. Declared forbidden file hashes must resolve uniquely inside
  the evaluator closure and are audited as content, not merely as hash names;
- `c6-gate-policy.ts` schema v4 freezes the positions-two-and-later equal-
  episode estimand, keeps the paired episode bootstrap diagnostic-only, and
  adds canonical upstream repository-family clustering, repository-then-
  episode hierarchical bootstrap, equal-repository sensitivity, complete
  leave-one-repository-out influence reporting, and explicit superiority and
  non-inferiority acceptance bounds. It explicitly limits the primary coding
  cohort to `real-history` and `external-benchmark`, while
  `controlled-mutation` is diagnostic-only, excluded from the primary
  estimand, cross-classified by repository and mutation family, and separately
  reported. It also freezes arm/path/hash integrity checks, hook registration,
  feature-enable, injection, Stop, and ledger evidence, +10-point primary
  threshold, +3-point strong-control threshold, and claim-branch wording.
  It also requires every GoodMemory stage/seed to rebuild from that stage's
  upstream-frozen sealed prefix, records Stop/writeback only for host
  integrity, then discards the store and prohibits carryover across stages,
  seeds, or arms.
  Superiority requires both hierarchical interval lower bounds and every LORO
  delta to remain above zero. Non-inferiority branches name the comparator and
  apply the same three checks above the negative margin. A freeze-time,
  outcome-blind, independently reviewed repository design/power artifact is
  required before both candidate freeze and full execution;
- `c6-flat-summary.ts` schema v3 binds one re-audited summary per non-empty
  stage-history binding to the same frozen-prehistory hash and maximum
  injection budget as GoodMemory, with
  frozen provider/model/prompt/pricing/token-counter identities, an exact
  output hash, injected size recomputed from that output by the same frozen
  `goodmemory-estimate-text-tokens-v1` estimator used by installed-host
  GoodMemory, separate provider-output-token usage, and
  cost recomputed from the frozen token prices; caller-declared injection
  counts are not accepted. The receipt contract hashes and counts each arm's
  final injected text, freezes flat-summary as
  `verbatim-summary-output-no-wrapper-v1`, and freezes GoodMemory as
  `goodmemory-installed-host-additional-context-v1`; the helper is not yet
  connected to a packaged-Linux runner and therefore is not actual treatment
  parity evidence. Equal aggregate tokens are also insufficient if native
  GoodMemory injects multiple ordered hook events while flat-summary is placed
  once or at a different event. Before summaries are generated, the packaged
  profile must recover the exact ordered event/segment sequence, bind per-event
  content hashes and token counts plus an ordered composition hash, and freeze
  equivalent flat-summary placement and per-event caps; unrecoverable native
  composition makes the pair incomparable. Its current artifact builder does not authenticate
  generation facts, so raw provider request/response, timing, usage, and
  raw-to-normalized receipts are a hard prerequisite before run identity or
  Codex execution. A `no-history-negative-control` stage is instead bound to
  canonical zero-byte history with zero source units: it invokes no summary
  provider, writes no summary artifact, and both treatment arms carry the
  explicit `no-history-zero-injection` receipt;
- `prepare:codex-coding-effect:c6-candidate` performs only those deterministic
  reads and prints the candidate plan. It writes no result artifact and invokes
  neither the summary provider nor Codex.

The resulting readiness state is deliberately
`preflight-accepted-freeze-prerequisites-required`, with
`candidateManifestFrozen: false` and `codexRunReady: false`. The preflight
accepts deterministic structure only. It records package source-to-archive
proof, repository URL/commit/snapshot proof, license receipts, and independent
semantic-duplicate review as required before candidate freeze. Each
`real-history` input must already bind an asset-locked source record to a
review-receipt structure. The strict source record includes the
raw original-request hash, matching repository URL/base commit, an HTTPS
source locator plus immutable revision, and the exact candidate
`taskContentSha256`; that fingerprint contains only the agent-visible
repository tree and ordered prompts and excludes gold, hidden tests,
expected-file labels, and evaluator metadata. The review receipt hash covers
the full source record. A dataset-level canonical
request/input/dispatch/response/provenance envelope then binds every
real-history receipt and source record and checks author/reviewer separation.
The current envelope truthfully records
`orchestrator-observed-dispatch-no-cryptographic-receipt`, so its structure is
reproducible but independent authenticity remains required before candidate
freeze. A source-type label, unrelated text file, renamed reviewer, or
free-form provenance string is insufficient. Agent-visible byte fingerprints
prevent literal task copies but cannot establish independent statistical
units. This is not a completed C6 dataset, source-reproducible
package, source-proven repository set, packaged-Linux profile, summary corpus,
Linux replay, Codex run, or coding-effect result.

The deterministic preflight command is:

~~~bash
bun run prepare:codex-coding-effect:c6-candidate \
  --dataset-root=<asset-locked-candidate-root> \
  --c5-evidence-root=reports/quality-gates/phase-73/c5-native-longitudinal-pilot-v16 \
  --environment-manifest=<linux-x64-environment.json> \
  --gate-policy=<c6-gate-policy.json> \
  --package-tarball=<goodmemory.tgz> \
  --summary-protocol=<summary-protocol.json> \
  --seed=<seed-1> \
  --seed=<seed-2> \
  --seed=<seed-3>
~~~

All scalar arguments use `--name=value`; each scalar is required exactly once
and `--seed` is required exactly three times with distinct canonical positive
integers. The package path must name a `.tgz`. The environment manifest freezes
the Linux/x64 image hash, Codex executable hash/version/model/reasoning effort,
package version/hash, runner commit/tree, network-off policy, concurrency, and
timeouts, and declares `package-tarball-only` as the GoodMemory install source.
The summary protocol freezes the provider/model, prompt file/hash, pricing
  snapshot file/hash, maximum injected tokens, one-generation-per-distinct-
  non-empty-stage-history reuse policy, mandatory leakage audit, the exact
`goodmemory-estimate-text-tokens-v1` injection counter identity, which is the
exact estimator used by installed-host GoodMemory, flat-summary's verbatim
no-wrapper composition identity, and
`rawGoldAccess: false`. The pricing snapshot includes ordered
effective/observation times, an HTTPS source locator, and a hash-bound local
receipt. That receipt protects local identity only; the cost branch additionally
requires independent source review. The gate-policy file freezes every
documented C7 decision threshold and claim branch. The loader re-hashes every
referenced file and rejects a mismatch before producing the plan.

Before candidate freeze, the archive must be tied to an exact source commit/tree
and source-to-package file closure. Every repository URL/base commit and stage
snapshot must be proven against the locked asset tree, redistribution must have
a review receipt, and semantic duplicates must be independently reviewed.
The final Codex executable is also an experiment input, not ambient host state.
Its package/lock, platform-specific Linux x64 tarball, installed wrapper and
native executable hashes, version output, and pinned-image offline-install
receipt must be frozen before the packaged host profile can pass.
Before any summary is generated, that source-proven package must be installed
in the pinned Linux image and emit the GoodMemory profile/config evidence that fixes
`sourceSha256`, `normalizedSha256`, `maxTokens`,
`sessionStartMaxTokens`, `contextMode`, `promptInjection`, and actual per-stage
ordered hook events/segments, injected text hashes/counts, the shared counter
identity, and the installed-host `additionalContext` composition identity.
The receipt must preserve transcript order rather than sorting by content hash,
and must freeze equivalent flat-summary event placement and per-event caps;
otherwise the pair is incomparable even when aggregate token counts match.
Until those receipts exist, the
flat-summary equal-budget
status is `pending-packaged-linux-host-profile-capture`; a caller-supplied
maximum alone is not evidence of treatment parity. Each later summary must also
carry an authenticated provider request/response and raw-to-normalized receipt;
a caller-provided output/usage object is not generation provenance.

The C6 claim candidate uses a stage-scoped Protocol A: within one stage, every
arm receives the same upstream-frozen prior-history source. A later historical
stage may bind a longer sealed prefix, but that prefix is frozen before any
experimental result and is identical across arms. The GoodMemory result can
therefore support only the
narrow claim that its historical selection and injection policy improves
fresh-session Codex outcomes under this protocol. C5 remains the separate
Protocol B native-writeback pilot; C6 must not relabel Protocol A as end-to-end
native Stop/writeback superiority. For every GoodMemory stage and seed, the
runner rebuilds a fresh store from that stage's sealed prefix. It records the
stage's Stop/writeback outcome and ledger as host-integrity evidence, then
discards the store whether the stage finalizes or aborts; writeback never
becomes treatment input for a later stage or seed.

The frozen three-arm order is:

1. `no-memory`;
2. `flat-summary`;
3. `goodmemory-installed`.

For each episode, the three seeds assign every arm exactly once to execution
position 1, 2, and 3. Global balance alone is insufficient. A summary is
generated once per distinct non-empty stage-history binding before arm
execution and its exact output hash is reused across all three seeds.
Identical history hashes may reuse a summary; different prefixes may not.
No-history controls generate and inject nothing. Regenerating a summary per
seed would confound the arm comparison with summary variance.

The C5 power calculation used a 10-percentage-point material effect. Therefore
the C6 primary delta threshold is frozen at +10.0 points versus no-memory, not
+5.0 points. The strong-control accuracy threshold remains +3.0 points versus
flat-summary. Repository-robust superiority additionally requires positive
repository-then-episode hierarchical lower bounds for both the episode-
weighted and equal-repository statistics and a positive delta after omitting
every repository. Both estimands apply to positions two and later; position 1
remains a diagnostic and cannot silently enter the headline denominator.

The C6 readiness ladder is:

1. deterministic preflight implementation and focused tests complete,
   including stage-scoped sealed-prefix dataset, lineage, summary, leakage, and
   gate-policy contracts;
2. primary source pool assembled above the 391 `minimumEpisodeFloor`, then an
   outcome-blind final candidate dataset and asset lock frozen to exactly 391
   `real-history` or `external-benchmark` rows with three stages each, exactly
   391 distinct agent-visible byte fingerprints, at least 48
   `real-history` episodes, 48 exclusive primary episodes per stratum,
   normalized source-
   record lineage for every ordered stage, a frozen outcome-blind repository-
   family allocation/power artifact, and an independent semantic-duplicate
   review; every primary episode has an asset-bound strict source record
   tying original request, immutable source, repository identity, and
   candidate task content to an asset-bound review receipt. External benchmark
   rows additionally bind exact dataset revision/path/file hash/row identity
   and a source-specific task/history projector. Every episode edge must carry
   a structured chronology, prior-completion, merge/base-ancestry, and concrete
   dependency decision. Dataset-level request/input/dispatch/response
   provenance must be independently authenticated before freeze;
3. package source-to-archive proof, repository URL/commit/snapshot proof,
   redistribution receipts, Linux image/environment, gate policy, summary
   prompt/token counter, and receipt-bound pricing snapshot assembled;
4. exact packaged-Linux GoodMemory profile/config and real injection-token
   receipts captured, then equal summary budget fixed;
5. final claim-candidate manifest frozen to the exact 391-episode,
   three-stage schedule; the independently reviewed eligible-position artifact
   does not authorize a smaller budget;
6. one summary artifact per distinct candidate stage-history binding, at most
   one per scored stage and reused across seeds only, generated with
   authenticated provider/raw-normalization receipts and dynamically
   leakage-accepted;
7. final run identity materialized with all summary output and receipt hashes;
8. exactly 10557 three-arm Codex stage calls executed with every attempt
   retained;
9. zero unresolved infrastructure failures and the frozen statistical report
   complete;
10. C7 independent replay/gate decides whether any narrow claim is allowed,
    with independent price-source review required for the cost branch.

Step 1 remains the only completed readiness-ladder step under the corrected
stage-scoped protocol. Dataset v3, lineage v2, summary protocol/artifact v3,
candidate-plan v6, leakage, gate policy v4, readiness, CLI, and the end-to-end
fixture consume the same sealed-prefix and zero-history contracts. The v6/v4
source-cohort replacement preserves the frozen 10,557-call primary schedule:
controlled mutations cannot satisfy the 391-episode floor and cannot appear in
the primary candidate dataset. Focused and full validation counts must be
refreshed after the downstream fixture and power-review repairs complete. This
still closes deterministic preflight implementation only; steps 2 through 10
remain open.

#### C6-T001: expand/finalize dataset

- meet minimum episode/repository/language counts;
- add real-history or continuously refreshed tasks;
- keep controlled mutations in a separate diagnostic registry, excluded from
  the primary dataset, primary estimand, quotas, and 10,557-call schedule;
- seal the dataset intake/selection closure; final claim-candidate freeze
  remains a later readiness step.

The implemented T001 intake guard is still preflight infrastructure, not a
dataset. Each C6 episode must declare exactly one `primaryStratum`; the 48-row
quota is computed only from that exclusive field. Multi-label
positions-two-and-later strata remain diagnostic and cannot let one episode
fill several sampling buckets. `no-history-negative-control` must use `none`
mode with no dependency at every scored position.

The accepted-episode count is still zero. No scalable base-repository or
mutation-family registry and no 391-episode freeze manifest exists. C6-T001a
does now provide the first real, licensed, commit/tree-pinned
controlled-mutation canary. It binds `unjs/defu` commit
`82632b66f5914e9946edce300e10633a3d5c0cb7`, tree
`f98fd0ecb1056fb087f117a97241a433309f087c`, the exact MIT text, one
source-only six-file agent projection, two genuinely different mutation
families, and one cosmetic null-default variant classified as a semantic
duplicate. Cosmetic prompt/path/control-flow variants do not count toward the
391 floor, stratum quotas, repository-family count, or effective sample size.

The canary closes only a mechanical lower bound. Repository-family identity is
inside the frozen supply; an exact evaluator-closure plus gold-outcome clone
cannot be split into a second family; every prompt is checked against the
complete canary gold/F2P/P2P/base-health hidden set; and the actual evaluator
factory and target modules execute from content-hashed in-memory bundles.
Mutation tests reject both the self-reported-semantic-family split and direct
gold/hidden-evaluator prompt injection. The supply remains explicit that
`semanticEquivalenceReviewVerified: false`: differently encoded semantic
clones still require independent gold-blind review.

The tracked Linux/amd64 observation is
`reports/quality-gates/phase-73/c6-controlled-mutation-canary/linux-amd64-receipt.json`
at SHA-256
`b084eda0c425925947644e59f9c86495743d381c5ab19e728bc9b6712211c60b`.
It replays twice in pinned image
`6967283eaf7c1e0ca4dbf4c72fd43b1cf3676f28371a635619fde3f07975373c`
with identical run closure
`383247fa598266ca00ff45d8f79cc336e845e36c75df54afe63cd53a0ff126cd`;
the explicit gate passes both locally and in that Linux image. This is still a
local unauthenticated observation: the receipt says
`receiptAuthentication: "none"`, `networkIsolation: "not-attested"`,
`evaluatorDependencyClosureFrozen: false`, `fullUpstreamCiExecuted: false`,
`candidateManifestFrozen: false`, and `codexRunReady: false`. It does not prove
a sealed Codex mount, independent semantic acceptance, an accepted C6 episode,
or coding uplift.

Every C6 manifest must also bind
`provenance/dataset-lineage/lineage.json`. Its source snapshots bind an
immutable revision, source-population manifest, and source-license receipt
structure. Each population binds a normalized source-record JSONL artifact and
each unit's exact row index and bytes. Its episode map binds the agent-visible
task fingerprint, frozen prehistory source units plus a materialization-binding
digest, and the full ordered stage-to-target-source-record list. Target unit
IDs, normalized record hashes, and locators are globally unique, and no target
may reappear in the candidate prehistory set under any of those identities.
The source snapshot revision and each upstream item revision are separate
fields; every ordered-stage real-history record must match the reviewed
task-origin locator, `ecmascript-string-trim-v1` original-request hash, and
item revision.
This blocks exact reuse and aliasing inside the frozen local record closure. It
does not authenticate those local captures against the upstream service,
reproduce the prehistory artifact from the named units, or establish that a
claimed three-task relationship is real. Deterministic materialization or an
independently authenticated receipt, relationship review, and
semantic-duplicate review remain required.

The current upstream shortlist is intentionally a source pool, not an accepted
C6 dataset:

- SWE-bench Multilingual revision
  `e5c585e008e2cb5eecc7c64192d855c53279d788` supplies 300 multilingual
  single-issue tasks;
- Multi-SWE-bench revision
  `56ff018c04a38e27ada1e9d0a6d5839a51f88f0d` supplies a larger
  multi-language real-PR pool and is the best candidate for mining historical
  follow-up chains;
- SWE-bench-Live MultiLang revision
  `608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b` supplies fresher tasks for
  contamination reduction.

The first tracked source-pool snapshot is now materialized at
`fixtures/codex-coding-effect/c6-source-pool/swe-bench-multilingual-e5c585e.source-pool.json`.
It is generated only from the exact SWE-bench Multilingual Parquet at revision
`e5c585e008e2cb5eecc7c64192d855c53279d788`, path
`data/test-00000-of-00001.parquet`, byte length `1165968`, and SHA-256
`28b7f874e48496399077d276f9f2b163a077ddf0a70dc507c148d58da826baa9`.
The exact 729-byte dataset-card README is separately pinned at SHA-256
`05d5096b015147c8cd7de51579965aacc5a184b1c5c90e5ccdb2109fb1f11dc1`.
The resulting 333573-byte snapshot has SHA-256
`15cf8d4a0a7ab0e3e7dee32555f266f1bccfd47ace7f5b31d8e474e064c37cf5`
and commits every one of the 300 normalized rows across 41 repositories
without retaining the original problem, gold patch, test patch, or test-name
text. Mechanical screening queues 274 rows for origin and relationship review
and rejects 26 before origin review: 25 lack a non-empty pass-to-pass set and
one lacks a non-empty fail-to-pass set. The snapshot calls MIT only the
dataset-card license; historical license evidence for each upstream repository
is still required.

This snapshot is a reproducible source-pool capture, not an accepted/rejected
episode partition. It deliberately records `acceptedEpisodeCount: 0` and
`candidateManifestFrozen: false`. It does not yet bind original issue/PR
responses, repository reachability and trees, project licenses, Linux
base/gold/protection replay, chronological dependency evidence, deterministic
prehistory materialization, or independent relationship/semantic-duplicate
review. This was captured while the prior episode-level step 1 was still the
active protocol; that step is now superseded and reopened by the stage-scoped
history correction.

The local-only reproduction command is:

~~~bash
bun run snapshot:codex-coding-effect:c6-source-pool \
  --parquet-file=<exact-pinned-parquet> \
  --readme-file=<exact-pinned-dataset-card> \
  --output=<new-source-pool-snapshot.json>
~~~

The command requires `--name=value` inputs, verifies both upstream byte
lengths and hashes before parsing, reads the verified Parquet bytes once,
serializes deterministically, and refuses to overwrite an existing output.

The second tracked capture is the deliberately small Multi-SWE-bench jq slice
at revision `56ff018c04a38e27ada1e9d0a6d5839a51f88f0d`, path
`c/jqlang__jq_dataset.jsonl`. The exact LF-terminated JSONL is 148809 bytes
with SHA-256
`8be07a2281fa766b310037db9bc2abc3f8c7150c3d471ea56a964921d5609e8f`;
the 11283-byte dataset card has SHA-256
`26638a5dc8d8c10e04de4578c904beecefb584d44e618cfe2c33fd350ca9810d`.
The card's metadata says `license: other`; its body makes only a conditional
CC0 statement subject to ByteDance rights and each upstream project's
license, so the capture does not relabel the source or jq repository as
unconditionally CC0.

The resulting tracked source-pool artifact
`multi-swe-jq-56ff018.source-pool.json` is 25676 bytes with SHA-256
`fe513b9810bcc2bee926402c8384a4a0e438dd5ed5495b8d84fe3a4665fe1d4e`.
It commits all 17 raw records including each terminating LF while retaining
only hashes and provenance metadata, not original issue, pull-request, gold,
or test text. All 17 rows are queued for origin, ancestry, semantic, and
replay review. Canonical identity is repository plus upstream pull number:
four tasks (`2658`, `2728`, `2839`, and `2919`) alias tasks already present in
the SWE-bench Multilingual pool, including two whose benchmark variants use a
different base commit. Therefore the slice adds at most 13 new canonical
upstream tasks, not 17.

The paired tracked artifact
`multi-swe-jq-56ff018.chain-decisions.json` is 700325 bytes with SHA-256
`4d0942ec59aa3de906c9c621211d84ae7750d2f3d4f953d65f59fdd00d22154a`.
It explicitly enumerates the full slice-local unordered universe:
`C(17,2) = 136` pairs and `C(17,3) = 680` triples. Every triple is
`blocked`, every `orderedSourceUnitIds` is null, and the serialized member
order is explicitly ascending pull number rather than chronology.
`acceptedEpisodeCount` remains zero. This closes only combinatorial
enumeration for the 17-row canary; it does not close intake selection or the
391-episode dataset.

Five exact raw GitHub API response captures bind PRs `2824`, `2839`, `2840`
and compare edges `2824 -> 2839`, `2839 -> 2840`. They show that the first
merge commit is an ancestor of the second task's base by six commits and the
second merge commit is an ancestor of the third task's base by one commit.
The ledger calls these only
`local-capture-verified-no-independent-authentication`: the responses have no
platform signature or independent receipt. More importantly, commit ancestry
does not prove semantic memory dependency. The three PRs remain an unordered,
blocked canary because no gold-blind independent review ties a concrete
earlier contract or decision to a later original request.

The receipt closure also binds a 6026-byte jq `COPYING` capture from the first
observed base commit at SHA-256
`10e974638a41fadfd72357f2f3a4325e20b856c563365128f72feaa406f8c92d`.
It is explicitly `single-base-capture-only` with `reviewVerified: false`; it
does not establish all-stage historical license coverage. The ledger also
keeps independent ancestry authentication, semantic review, Linux replay,
project-license review, deterministic prehistory, and cross-source duplicate
review false or pending.

The local reproduction commands are:

~~~bash
bun run snapshot:codex-coding-effect:c6-multi-swe-jq-source-pool \
  --jsonl-file=<exact-pinned-jsonl> \
  --readme-file=<exact-pinned-dataset-card> \
  --existing-source-pool=<tracked-swe-source-pool.json> \
  --output=<new-jq-source-pool.json>

bun run snapshot:codex-coding-effect:c6-multi-swe-jq-chain-ledger \
  --jsonl-file=<exact-pinned-jsonl> \
  --readme-file=<exact-pinned-dataset-card> \
  --existing-source-pool=<tracked-swe-source-pool.json> \
  --pull-2824=<tracked-response.json> \
  --pull-2839=<tracked-response.json> \
  --pull-2840=<tracked-response.json> \
  --compare-2824-to-2839=<tracked-response.json> \
  --compare-2839-to-2840=<tracked-response.json> \
  --project-license=<tracked-COPYING> \
  --output=<new-chain-decisions.json>
~~~

Both commands verify exact input bytes and refuse to overwrite output. Neither
constructs an agent-visible prompt, episode, prehistory artifact, or candidate
manifest. The original-request construction policy remains deliberately
unfrozen because Multi-SWE-bench contains both pull-request title/body and
resolved-issue title/body; choosing the solution PR body as a prompt could
leak the gold approach.

The third tracked intake increment makes relationship discovery systematic
before selecting a repository. A 38112-byte locally merged, 59-entry Hugging
Face revision-tree capture at SHA-256
`69b4797acb34252fcc726daf6d3e0480577017d9b8faf25b7dbd53f7f82e07b6`
contains 47 matching `_dataset.jsonl` entries and defines the complete
threshold-selected tranche relative to that captured body. It does not retain
the original response headers or independently authenticate pagination. The
resulting 24 exact source files no larger than 1000000 bytes contain 261
LF-terminated records across 24 repositories and 9725174 source bytes. Every
file path, byte length, Git blob OID, and SHA-256 is pinned by
`multi-swe-under-1mb-56ff018.relationship-discovery.json`; the raw task,
solution, and test text is not copied into that artifact.

The schema-v2 29589-byte relationship-discovery artifact has SHA-256
`4c7fb407078905f2ad1705f21e617796b31fcca4777cb8fd912e0801f6c20c06`
and population digest
`e79d4812f1e4e1877c94d9dece3201973e10a5373334e0da7e35aa5ffd4af144`.
It finds 15 canonical repository-plus-pull aliases against the first
SWE-bench Multilingual pool, leaving at most 246 new upstream tasks. Its
declared mechanical rule scans only solution pull-request bodies and promotes
a relationship candidate only when one later body qualifies two different
source pull numbers with `PR #...` or `pull request #...`. Mutable resolved
issue text cannot promote a candidate. Six reference signals and six
shared-issue groups are retained, but same-issue, bare-number, two-node, and
parallel/superseding signals remain ambiguity evidence rather than dependency
proof.

Exactly one triple passes that discovery rule: `sharkdp/bat` pulls `2896`,
`3075`, and `3189`. Hash-bound pull, original-issue, and compare captures
establish only the local merge/base order `3075 -> 2896 -> 3189`: pull
`3075`'s merge commit is an ancestor of pull `2896`'s source base by 39
commits, and pull `2896`'s merge commit is an ancestor of pull `3189`'s source
base by 90 commits. Each source row matches its captured pull and original
issue response. The third solution pull body explicitly says that pull `2896`
reintroduced behavior previously fixed by pull `3075` and issue `3073`.

The same captures disprove that order for original requests. Both issue
creation and pull creation order the tasks `2896 -> 3075 -> 3189`: issue
`1746` was created on 2021-07-21 and pull `2896` on 2024-03-15, before issue
`3073` on 2024-08-18 and pull `3075` on 2024-08-25. The artifact therefore
classifies this as `relationshipKind: merge-order-regression`, records
`mergeChronologyVerified: true` and `requestChronologyVerified: false`, and
sets the candidate status to
`merge-order-regression-candidate-original-request-chronology-conflict`.
It is not a chronological real-history episode under the current contract.
It may remain a policy-review candidate, but cannot enter the 391-episode
claim set unless a uniform merge-order-regression class is preregistered before
candidate selection; otherwise it must be rejected.

That is a locally verified merge-order regression candidate, not an accepted
episode.
The qualifying text is evaluator-only solution-PR evidence and is not a frozen
agent-visible request. The GitHub responses are local public-API captures with
no platform signature or independent authentication, and no gold-blind
independent reviewer has decided whether the prior constraint is useful beyond
what the original issues already reveal. Repository commit reachability and
trees, historical project licenses, base/gold/protection Linux replay,
cross-stage gold/leakage review, deterministic prehistory, prompt construction,
full source-population selection closure, and semantic duplicate review are
also open. Therefore the artifact records
`orderedOriginalRequestChronologyVerifiedCandidates: 0`,
`acceptedEpisodeCount: 0`, `candidateManifestFrozen: false`, and
`fullMultiSWESourcePopulationCovered: false`.

The local reproduction command is:

~~~bash
bun run snapshot:codex-coding-effect:c6-multi-swe-relationship-discovery \
  --source-root=<exact-revision-tree-with-original-paths> \
  --readme-file=<exact-pinned-dataset-card> \
  --tree-receipt=<tracked-revision-tree-response.json> \
  --existing-source-pool=<tracked-swe-source-pool.json> \
  --pull-3075=<tracked-response.json> \
  --pull-2896=<tracked-response.json> \
  --pull-3189=<tracked-response.json> \
  --issue-3073=<tracked-response.json> \
  --issue-1746=<tracked-response.json> \
  --issue-3188=<tracked-response.json> \
  --compare-3075-to-2896=<tracked-response.json> \
  --compare-2896-to-3189=<tracked-response.json> \
  --output=<new-relationship-discovery.json>
~~~

The command verifies the capture-relative threshold-selected tree closure and
every input byte before parsing, serializes deterministically, and refuses to
overwrite an existing output. The explicit Phase-73 replay gate executes the
complete loader, byte-for-byte artifact replay, overwrite refusal, and a
chronology-receipt mutation probe when
`GOODMEMORY_TEST_C6_MULTI_SWE_SOURCE_ROOT` and
`GOODMEMORY_TEST_C6_MULTI_SWE_README_FILE` point at the pinned external
source files. It skips without those external inputs because the raw dataset
text is deliberately not vendored.

The fourth tracked intake increment broadens only the deterministic local
scan, not the accepted dataset. Relative to the same expected-hash-bound local
tree body, it covers every `_dataset.jsonl` file no larger than 15000000
bytes: 39 files, 561 LF-terminated rows, and 561 canonical PR anchors. Exactly
four provided local GitHub response bodies are bound per anchor (`pull`,
`review-comments`, `reviews`, and `commits`), for 2244 files. Component-wise
symlink rejection and complete source/capture closure hashes are recomputed at
the end of the scan so a mixed-time local snapshot fails closed.

The resulting 876631-byte artifact
`multi-swe-under-15mb-56ff018.real-history-yield.json` has SHA-256
`afe795834113e1b859783948d2977511e77d6126563d6c5f481385d085a3b076`,
source population digest
`f3ba9207bca5c337238ccb7ec6642d31b34e296084a59ba39048cc1be1d5eec4`,
source closure digest
`5502cc545a462d43bdd419395c0529a30ace1242f74863b7fb5d0d892c7cd53b`,
and capture closure digest
`02fccaefa843bead506eb73cb76491a75056fc717b9eb22bebb83ef171ce6687`.
Inline review comments use the historical `original_commit_id` for the
reviewed commit and retain mutable `commit_id` separately. Request-like inline
comments and review bodies feed a timestamp-only heuristic with no ancestry
claim. It finds 39 strict heuristic signals, 90 anchors with two such events
but no matching sequence, 430 with fewer than two, and two unresolved
repository-identity redirects.

Those 39 are neither accepted episodes nor a mathematical upper bound.
The provided bodies omit issue/PR discussion comments, request URLs, response
headers, and independently verifiable pagination closure; username shape does
not prove a human reviewer. The artifact therefore records
`feasibilityConclusion:
not-estimable-from-partial-review-signal-surface`, not “48 is infeasible.”
Platform authenticity, repository identity redirects, commit/tree reachability,
semantic dependency, project licenses, Linux replay, deterministic prehistory,
cross-stage leakage review, and independent intake review remain open.
`acceptedEpisodeCount` is zero and `candidateManifestFrozen` is false.

The local reproduction command is:

~~~bash
bun run snapshot:codex-coding-effect:c6-real-history-yield \
  --source-root=<exact-39-file-local-source-root> \
  --tree-receipt=<tracked-local-tree-response.json> \
  --expected-tree-receipt-sha256=69b4797acb34252fcc726daf6d3e0480577017d9b8faf25b7dbd53f7f82e07b6 \
  --capture-root=<exact-2244-file-local-response-body-root> \
  --minimum-required-episodes=48 \
  --output=<new-real-history-yield.json>
~~~

The explicit replay gate requires
`GOODMEMORY_TEST_C6_REAL_HISTORY_SOURCE_ROOT` and
`GOODMEMORY_TEST_C6_REAL_HISTORY_CAPTURE_ROOT`, reproduces all 561 decisions
byte-for-byte, and verifies overwrite refusal. It skips when those non-vendored
raw inputs are unavailable.

The fifth intake increment closes the discovery inventory over the complete
captured Multi-SWE revision tree without claiming that any row is an episode.
All 47 `_dataset.jsonl` files are present with their exact tree identities:
1764624161 source bytes, 1737 LF-terminated rows, 47 repositories, and 1737
canonical PR anchors. The current paginated Hugging Face tree capture is kept
distinct from the earlier 38112-byte local body. Its two raw pages contain 50
and 9 entries; their merged 38412-byte body has SHA-256
`8de0f6501c0fa3dd844d38704a4a44eb8f3b4aaa997aa74c9507c79d501c8384`.
The tracked page bodies and pagination receipt make the local merge
reproducible, but do not convert HTTPS into a signed upstream attestation.

Every anchor has a four-file GraphQL capture containing the redacted request,
selected response headers, raw response, and capture manifest. Repository
identity is exact for 1692 anchors and explicitly redirected for 45:
43 from `pinterest/ktlint` to `ktlint/ktlint`, and two from
`square/okhttp` to `lysine-dev/okhttp`. GraphQL pagination is complete for
1735 anchors. `cli/cli#7201` and `tokio-rs/tracing#1523` exceeded the first
100 commits; strict REST supplement captures contain 114 and 141 commits,
respectively. The inventory verifies the REST base/head against GraphQL and
requires the GraphQL first-page commit list to be the exact REST prefix, so a
self-consistent but unrelated supplement is rejected.

The resulting 2645700-byte
`multi-swe-full-56ff018.github-graphql-discovery-inventory.json` has SHA-256
`14c406f6bb9d4b8c789380b62511bd1312dd67819eaeb44d64c9ea54593bed51`.
It records 1737 complete captures, 45 redirects, two raw GraphQL pagination
gaps, two strict supplements, and 1737 effective-complete discovery surfaces.
Its explicit Phase-73 gate re-reads the non-vendored full source, GraphQL
capture, and REST supplement roots, reproduces the tracked artifact
byte-for-byte, and rejects output overwrite. The raw source is 1.76 GB and the
GitHub captures remain external; the tracked inventory is their deterministic
projection, not a substitute for those inputs.

This full capture changes the next question from “did the partial scan omit
history?” to “which uniformly preregistered trajectories survive replay and
semantic acceptance?” It still contributes zero accepted episodes. The GitHub
captures are local authenticated-HTTPS sessions with no platform signature;
they do not by themselves prove account identity, semantic dependency,
repository replay, hidden fail/pass behavior, historical license, statistical
independence, or gold-blind intake acceptance. Accordingly the artifact keeps
`acceptedEpisodeCount: 0`, `candidateManifestFrozen: false`,
`codexRunReady: false`, and `upperBoundClaimPermitted: false`.

The next trajectory pass is also deterministic but still discovery-only. It
replays 175 preliminary targets, of which 160 have strict REST closure and 15
remain missing. It finds 156 targets with at least two non-author request
events, 148 timestamp sequences, and 146 sequences satisfying all three
parent-graph constraints: each fix descends from its reviewed commit and the
second fix descends from the first fix. Those three edges are necessary but
not sufficient for a linear two-review sequence: the second reviewed commit
must also descend from the first fix, and neither reviewed commit may postdate
its review event. 145 sequences meet the stricter rule; 79 have non-empty
fail-to-pass signals and 76 have both fail-to-pass and pass-to-pass signals.
`mui/material-ui#25259` is the sole three-edge signal rejected by the linear
rule because its second review points to a stale commit preceding the first
fix. Full search still recovers six valid branches previously hidden by the
earlier timestamp-first diagnostic. The 2568475-byte
`multi-swe-full-56ff018.review-trajectory-discovery.json` has SHA-256
`5931a911b919a9c53068311185f0bd1c78c0be18220ebe92c3b795c8e38357fd`;
its Phase-73 gate reproduces it byte-for-byte from the external raw roots.
An independent read-only audit rebuilt the DAG from `matchedCommits` instead
of trusting stored validity flags and reproduced the 160/146/145 counts plus
the single nonlinear rejection. The replay gate allows a 900-second cold-cache
budget after one complete scan exceeded its former 300-second ceiling; the
same inputs then passed from warm cache in 24.44 seconds.

The 76 strongest signals are not repository-balanced: 30 come from
`mui/material-ui`, 16 from `sveltejs/svelte`, 15 from `cli/cli`, and all 76
span only 12 raw upstream repositories. The top three therefore contribute
61/76 = 80.26%, the largest contributes 39.47%, and the size-concentration
equivalent-count diagnostic is approximately 4.07. This is not an effective
independent-repository count and does not create an outcome-free threshold; it
is direct evidence that the final allocation and repository-level
power/precision review must precede candidate freeze.

This pass was used to discover the eligible surface, so its 145 linear signals cannot
be retroactively called a preregistered episode sample. Before selecting any of
them, T001 must preregister and validate a construction rule, exact
stage/snapshot construction, sealed prehistory relationship, hidden-test
requirements, exclusion rules, and deduplication policy against this immutable
input artifact. A PR's two review rounds do not by themselves provide the
separate non-leaking prehistory required by Protocol A. Source-revision binding,
repository snapshot replay, licenses, semantic independence, and gold-blind
intake review remain required. The 76 linear rows with both test-signal types
are especially useful triage inputs, but they are neither proven
three-stage episodes nor evidence that the 391-episode requirement is met.

The first outcome-field-independent audit-order projection now binds the exact
`5931a911...57fd` trajectory artifact. It keeps all 145 eligible linear
signals across 22 repositories in its decision closure, ranks only immutable
lineage-visible fields, caps a repository at four signals, retains 54 after
that cap, and marks 48 priority seeds across 20 repositories. The tracked
projection SHA-256 is
`938ffaff2d185b3e3ba5d0ccf8e97f626879ffe0c7c44d65f6c6313958a06044`.
Its maximum priority allocation is 4/48 and its Kish concentration diagnostic
is approximately 14.96. The projection explicitly says that the 48 seeds are
not episodes, do not define the final exclusion set, and have not passed target
availability. It claims neither personnel outcome blindness nor semantic
acceptance. Its Phase-73 gate reproduces the complete 145-row closure and
retains the other 97 decisions rather than erasing them.

A transition-qualification intake now exact-binds both immutable projections,
preserves all 54 capped candidates in `cappedPoolRank` order, and freezes eight
requirements for each of three stages plus eight episode-wide
repository/license/authenticity/review requirements. It deliberately collects
no evidence and promotes nothing. Only 22/54 capped candidates have any
final-source fail-to-pass signal and 19/54 have both final-source
fail-to-pass/pass-to-pass signals; within the priority 48, those counts are 20
and 17. These source fields are availability hints, not transition-specific
evaluators. The tracked projection SHA-256 is
`59136d44da3f5687afe08cffbed98f0eae71a114389114cb422b73680c1185f8`;
the focused suite passes 6/6 with 35 assertions and the replay gate passes 1/1.
Its stop/go state is machine-qualified 0, independently accepted 0, dataset
assembly forbidden, and manifest unfrozen. This prevents the 48 priority seeds
from being silently relabelled as the minimum 48 real-history episodes.

The first real-history semantic-screening slice now proceeds in that exact
`cappedPoolRank` order. Its schema-v3 ledger requires a contiguous assessed
prefix, exact-binds the qualification and trajectory projections, binds every
candidate anchor, transition commit, and review-body hash, and binds a
separate reviewer receipt plus normalized-assessment hash to each candidate.
Every receipt records reviewer/author separation and explicit no-access
declarations for raw gold, outcomes, and hidden evaluators. The current
working-tree ledger SHA-256 is
`35a5ebc83da5a6ac4c3bc799d6d7484d7fc89e049b5ddb3e8b9ee752c9cc4796`.
The ledger also binds the exact whole-review versus inline-review-comment
event kind. Forty-two ranks are assessed in order. Ranks 1-4, 6-13, 15-18,
20-29, 31, and 33-42 are
rejected: their blockers are style/refactor/release-note/documentation-only
requests, already-passing targets, ambiguous requests, or selected fixes that
close a different review comment. Rank 5, `fmtlib/fmt#974`, is the first
later-stage semantic continuation and rank 14, `vuejs/core#9213`, is the
second; rank 19, `clap-rs/clap#2796`, is the third; rank 30,
`fmtlib/fmt#2310`, is the fourth; rank 32, `tokio-rs/tokio#5343`, is the
fifth. None is yet a machine-qualification
candidate under schema v3. Rank 5's
stages add builtin terminal-color behavior,
separate RGB and terminal-color representations, and replace assertion
failure for invalid terminal-color combinations with catchable
`format_error`; each selected transition closes its target. Rank 13,
`simdjson/simdjson#1667`, is rejected because its third target and selected
fix are documentation-only. Rank 14's stages respectively force a full
slot/fallback diff, unmount the old vnode instead of reusing it, and remove
extra custom-element renderer behavior; each selected fix aligns with its
frozen request and reviewed-commit boundary.
Rank 15, `sveltejs/svelte#12560`, is rejected because its stage-2 selected
fix closes a different review request and stage 3 only asks for rationale
while its selected fix changes documentation.
Rank 16, `cli/cli#9083`, is rejected because its stage-2 selected fix is an
unrelated upstream merge; the requested remote-selection behavior lands only
in the following commit and cannot be aggregated across the frozen boundary.
Rank 17, `sveltejs/svelte#13850`, is rejected because its stage-2 request and
selected fix change only changeset classification and wording rather than
executable behavior.
Rank 18, `anuraghazra/github-readme-stats#2099`, is rejected because its
stage-2 request and selected fix change only README formatting.
Rank 20, `sveltejs/svelte#12413`, is paired with an unrelated merge. Rank 21,
`google/gson#1787`, has an ambiguous second request and test-style-only third
request. Rank 22, `vuejs/core#10416`, has only a test-only type refinement and
comment request. Rank 23, `tokio-rs/tokio#6618`, pairs a test-migration request
with a production-code transition. Rank 24, `tokio-rs/tokio#6409`, only
observes inconsistent documentation at stage 3. Rank 25,
`detekt/detekt#7635`, refers to two absent thoughts rather than supplying a
self-contained stage-2 request. Rank 26, `facebook/zstd#1726`, asks for a
bounded `srcSizeHint` library/CCtxParams parameter and dictionary/parameter
selection at stage 2, but its selected transition only moves pledged-size
handling in `programs/fileio.c`; stage 3 asks to keep `contentSizeFlag`
enabled while its selected transition only removes unused source-size
plumbing. Rank 27, `vuejs/core#8470`, is rejected because stage 2 only
corrects `entends` to `extends` in a test name; stage 1 is behavioral and
stage 3's Node/browser parse-compatibility request aligns with its selected
production transition, but the typo-only middle stage is not a behavioral
coding task. Rank 28, `vuejs/core#10522`, is rejected because stage 3 only
renames a test with clearer CSS terminology; its scoped-CSS task and aligned
stage-2 fixture correction are behavioral, but the final stage is not.
Rank 29, `fasterxml/jackson-databind#3851`, is rejected because stage 2 asks
for a separate synchronized method while its selected transition instead
introduces inline `AtomicReference` compare-and-set logic; stage 3's
get-before-create request and transition align.
Rank 30's later requests make width apply to non-finite values without zero
fill and preserve explicitly requested alignment; both selected transitions
align.
Rank 31, `fmtlib/fmt#3863`, is rejected because stage 2 only removes a
redundant include and stage 3 only simplifies parser control flow with an
early return and switch; neither later stage requests observable behavior.
Rank 32's later stages define a 1000-iteration randomized `Sender::len`
pass/fail test and equal aggregate receive/send probabilities; both selected
test transitions align.
Rank 33, `ponylang/ponyc#3819`, is rejected because stages 2 and 3 only
request release-note/documentation wording changes; stage 3's selected
transition instead inlines an `AmbientAuth` expression in an example.
Rank 34, `ponylang/ponyc#3675`, is rejected because stage 3 only requests
Markdown line wrapping; its memory-safety task and zero-allocation stage 2
are behavioral and aligned.
Rank 35, `simdjson/simdjson#1695`, is rejected because stage 3 contains only
praise and a reviewer-owned documentation follow-up, not a self-contained
coding request; stages 1 and 2 are behavioral and aligned.
Rank 36, `ponylang/ponyc#4299`, is rejected because stage 2 requests
diagnostic regression assertions while its selected transition changes only
production diagnostics, and stage 3 is release-note wording only. The
fail-closed validator rejected an initial GraphQL-timestamp target that did
not match the frozen REST/linear-ancestry sequence; a fresh isolated review
binds the corrected stage-3 target.
Rank 37, `simdjson/simdjson#1615`, is rejected because stage 2 only explains
exception-free C++ context without requesting a change; its JSON Pointer task
and stage-3 explicit error-code propagation are behavioral and aligned.
Rank 38, `tokio-rs/tokio#6345`, is rejected because stage 3 only corrects a
documentation link; its owned-inner error behavior and public error-type
rename are behavioral and aligned.
Rank 39, `Hannah-Sten/TeXiFy-IDEA#3128`, is rejected because stage 3 gives
concrete cases but explicitly permits leaving behavior unchanged and offers
its quick-fix idea only tentatively. A reviewer correction preserved the rule
that unbound stage 1 cannot claim transition mismatch.
Rank 40, `tokio-rs/tracing#1983`, is rejected because stage 2 requests
integration tests for `EnvFilter`'s `Filter` implementation while its
selected transition only feature-gates the existing implementation and adds
no tests; stage 3 is unused-variable clippy cleanup only.
Rank 41, `elastic/logstash#14058`, is rejected because stage 3 requests a
behavioral distinction between dropped and discarded DLQ events, while its
selected transition only changes logging and leaves both paths in the same
counter exposed as `discarded_events`.
Rank 42, `elastic/logstash#13880`, is rejected because stage 3 requests
user-facing guidance to use the bundled JDK, while its selected transition
changes no warning diagnostic and instead adjusts no-JDK packaging plus
cleanup/debug output.

The prompt-construction correction defines
`resolved-issues-only-sorted-lf-trim-v1`: resolved issues are sorted,
line endings are normalized, and source PR title/body are always excluded as
evaluator-only fields. Its unit suite passes 3/3 with 9 assertions. Exact
prompt projections have not been incorporated into this ledger, so schema v3
records zero projections, `stage1AgentVisibleRequestsBound: false`, and
`machineQualificationCandidateCount: 0`. An independently audited rank-14
draft leakage fixture was deleted because it treated the forbidden PR
solution body as the stage-1 prompt and did not bind the alleged future-target
bytes. It could reject that prompt construction, not the candidate.
The separate exact projection and semantic-review receipt for ranks 5, 14,
and 19 predate ranks 30 and 32; both newer continuations still lack them.

Stage 1 is intentionally `beforeCommit: null` at this screening layer.
Mutable GitHub pull `base.sha` is diagnostic-only and cannot be treated as the
historical before snapshot; exact base/after ancestry remains a machine-
qualification requirement. Likewise, a reviewer cannot rescue a rejected
candidate by aggregating later commits after seeing the evidence. Rank 42 is
already closed in order; rank 43 is the next auditable candidate and later
ranks cannot be cherry-picked. Rank 13
records its actual bounded `fork-turns-3` context instead of claiming no
fork. The focused suite passes 6/6 with 16 assertions and the explicit
Phase-73 gate
passes 1/1 with 2 assertions.

This ledger is screening-only. It can reject a candidate or retain it for
prompt materialization, but it cannot qualify or accept an episode. The rank-5
continuation now has a separate fail-closed transition-evaluator screening
receipt. It binds asset-lock
`a9455232d26beeec738f647969506e248542dde4a6cb8d7405d270287aedeff0`,
asset root
`8a73c28419fe230e15130068a836d7c1e0043b1144aee94128eea43a5e2e369b`,
and evidence
`5235b39c9bffd688a62e384edf77c9ae165c7c9d898bb2ea83d821a74e1c12f8`.
The receipt exact-binds stage commits/trees, public-API evaluator sources,
six retained raw Git commit objects, retained logs, and an offline Linux/amd64
image digest. Its validator recomputes each commit-object ID and tree mapping,
derives stage 1 as fail-before/pass-after, and rejects rank 5 because stage 2's
selected after snapshot fails to compile for a normal public-header consumer
and stage 3 terminates after throwing inside `noexcept`. The stored
non-ancestry value remains an unauthenticated diagnostic and is not a
rejection reason. The protection slice is 13/13 but excludes `format-test`
and is not native-Linux-x64 complete.

The local Docker executor is not authenticated and the source repository
archive is not retained. The artifact therefore validates a frozen rejection
receipt, not independent proof of live execution, and it cannot promote an
episode. Rank 5 also still lacks the remaining repository/authenticity,
leakage, and independent-acceptance closure. Its reviewer receipt is not
cryptographically authenticated, the machine-qualified and accepted counts
remain zero, dataset assembly remains forbidden, and the candidate manifest
remains unfrozen. Focused unit tests pass 4/4 with 19 assertions; the explicit
Phase-73 gate passes 1/1 with 6 assertions.

A separate read-only reviewer accepted only the frozen-receipt rejection
derivation. The review receipt SHA-256 is
`70db5d33a9f165973107c2349ab5f9487ff239c76655451535690d7b59ffebaf`,
its lock is
`a7770e4d1c7dd6b7fd9bb17f3822e1e0e985018ceee16f66ca52d5380430f7a2`,
and its asset root is
`7671e327880434cef13fd4d02dfe2bd83a5e540991012dd8076c58f8bbe63421`.
It explicitly leaves reviewer identity, original Docker execution, and local
probe execution unauthenticated and cannot promote rank 5.

Thirty-seven semantic rejections plus the rank-5 machine rejection now leave at
most 16 possible qualifiers among the original 54 capped candidates. That
fixed pool cannot close T001. A separate expanded frame preserves those 54
rows byte-for-byte as its prefix and appends all 91 previously deferred rows
in frozen `eligibleRank` order. Its artifact SHA-256 is
`751929cc423d0ad132cbb5d5841a442242b9d59ab713406f352424a33c22def9`;
its metadata-independent candidate projection SHA-256 is
`f2875d922dc5aef657363660b9efd0b39799923cbd8068f84ef921791da2e47e`.
The replay gate chains the immutable trajectory-to-prehistory projection,
derives the rejection union from the same ledger object validated by the
review receipt, verifies the rank-12 amendment basis, and executes the
repository-cap then global-first-48 selector. The policy order was chosen
after rank 12, while current review metadata was refreshed after rank 13; the
temporal order is explicitly not cryptographically attested. Under the
current 38 definitive rejections, the 145-row frame has 107 remaining rows, a
conditional repository-capped maximum of 35, and margin -13. It no longer
meets the 48-episode minimum.

That zero-margin stop condition triggered a separate prospective expansion,
not a rewrite of the old frame. Structural-review policy v2 performs only a
broad GraphQL pretarget before pull-author data exists, applies exact
non-author/non-bot filtering after REST closure, ignores outcome/gold/test,
semantic and machine decisions, `isResolved`, `currentCommit`, and capture
hashes when constructing candidate identity, and excludes all 145 canonical
old-frame pulls. Its inventory-bound projection replays 1,737 upstream rows,
retains two unsupported pagination closures, and freezes 51 broad pretargets
across 13 repositories. Expansion artifact SHA-256 is
`629acdc312e611e066d181dacfb1206448c2a3f885921b99eff036159439317f`;
policy SHA-256 is
`b51613368026c09ad1aab3e4d08fe19197ddc1beea9499c9d8e068830527703a`.
The all-51 REST target projection was frozen before capture in plan SHA-256
`6de24fb5e71aed98341cd1f529645cf6d53826ce77bb8ff3ddeb105197860cbc`.

Strict REST capture closed 36 targets and left 15 missing fail-closed under
asset root
`eacf953f250d1ce652a85248aabec863555f4849bdb789f4c4be22fcbc460ff9`.
Missing closures remain infrastructure gaps rather than semantic decisions.
Exact author-aware replay yields 29 structural candidates and seven captured
no-sequence rows. Qualification artifact SHA-256 is
`256f267868303faf9e4fc4745508efaa023a241cb96d5bfac1a2c4a3aebfc5da`;
the v2-only capped structural ceiling is 23.

The combined frame preserves all 145 legacy ranks and appends the 29 exact v2
candidates only by frozen REST capture order. It does not move the prospective
tranche ahead of known rejections. Frame SHA-256 is
`7d44dd550f0921d8fa561fde0a6338f9b34afb076b182d05d76181ef4dcb6290`;
full candidate projection SHA-256 is
`0deafb438d2618a232aa0dd9b5981a6df2b189b48bc1753d03dbaa01b4ffa6b9`;
exact-v2 projection SHA-256 is
`28a3687c6341f6e67c26f5cbc21dc1d5fe49e0a327db89a7bfd55139c27a2606`.
Its raw 174 candidates span 23 canonical repositories with capped ceiling 61
and margin 13. The current rejection set is supplied only to a separate
capacity derivation: after 37 semantic rejections plus rank-5 machine
rejection, 136 candidates remain with capped ceiling 44 and margin -4.

These numbers do not promote a row. The REST attempt closure is not
cryptographically complete, semantic and machine qualification of the new
tranche have not started, accepted count is zero, manifest freeze is false,
and Codex run readiness is false. Given the observed 37/42 semantic rejection
rate, frame v1 is already structurally short; broader-source work remains
prudent before spending on transition qualification or model calls.

The 15 missing targets now have a separately frozen pull-identity supplement
plan at SHA-256
`72dcc45d43978cdda255937bd9773fb4f4685b7ac862416143dc1d777c97bfb6`
and a 15/15 local capture asset root at
`26e14cad198c2b12b71c9ecd4c77231447cd53ef6210e391ec6f24a841e53615`.
This is deliberately narrower than the original full REST protocol: GraphQL
continues to supply commit/review/thread history, while REST supplies the
canonical pull identity and author needed by the exact event policy. Capture
fails before writing if a response reflects the authorization token, rejects
an existing output before any request, publishes a no-replace tree, and
compares the complete asset lock before and after publication.

Qualification v2 binds the original qualification, supplement plan, GraphQL
root, and supplement root and replays all 51 targets. It yields 44 exact
structural candidates, seven no-sequence rows, zero missing identity closures,
and repository-capped ceiling 26. Its SHA-256 is
`e11752f957a3a8de992866ef2d83a36710a3e9134f5c84728100d67d5c87e0f3`.
The hardened-path recapture changed mutable raw response and manifest bytes
but reproduced the same structural-candidate projection.
The boundary is intentionally split:
`originalFullRestCaptureAttemptCompletenessProven` remains false and only
`pullIdentitySupplementClosureComplete` is true. A bearer header was sent,
but no cryptographic platform-authentication receipt exists.

Frame v2 is an append-only transition rather than a recomputation from the 44
exact results. It binds frame v1 and qualification v2, verifies that
qualification v2 descends from frame v1's exact qualification v1, preserves
the complete 174-candidate projection and order, and appends only the 15 newly
exact identity-supplement candidates at ranks 175-189 by original capture
order. Frame SHA-256 is
`9afc398b3475d5f4f6ab016c8fa36df80ed74880971acad789b54cbf4fcc022e`;
candidate projection SHA-256 is
`7b6499bfc62ad8a6c3fce9f26028bcd62354f4c3c4d86acc91e1deca5fe0c992`;
supplement-delta projection SHA-256 is
`efb86b1827955d67eb61e79a7e25a9707f5992c304be74603cb55c9295b34229`.
The frame explicitly records 15 still-missing full REST closures and zero
missing required identity closures. The raw 189 candidates span 25
repositories with capped ceiling 63 and margin 15. The 37 semantic-ledger
rejections and separately receipt-supported rank-5 machine rejection remain
derived diagnostics only; after applying them, 151 candidates across 19
repositories remain with capped ceiling 47 and margin -1. The qualification
and frame replay gates pass 1/1 with 6 and 11 assertions. Frame v2 can no
longer supply the required 48 episodes; freeze and replay an
outcome-independent prospective v3 source expansion before further expensive
transition qualification or any Codex calls.

This closes the 15 pull-identity infrastructure gaps, not C6-T001. No new row
has semantic acceptance or transition qualification; accepted and
machine-qualified counts remain zero; the candidate manifest remains
unfrozen; the summary corpus, package-isolated Linux proof, three-seed run,
statistics, and C7 gate remain open.

A tracked `sharkdp/fd#546` evaluator canary now demonstrates why audit order
cannot be promoted under the current schema. It binds asset-lock
`d1f87de8146cf05903bf83d5ebf3dd7c93e403f0ef625207e0d7e4288afbe2db`,
asset root
`b13f088c33b7a1862257d8b5521bcb3dcff9078b019a2e385e4148e876c077d9`,
and evidence projection
`b304af5ad2733aa05bb36d8ac7066bc93ab51bfeaca54d8d3cbb22f2a5846749`.
The exact Linux/amd64 replay observes 167/0 for base, 167/1 for test-only and
initial-plus-test, and 168/0 for gold-, first-fix-, and final-fix-plus-test.
It therefore distinguishes the first review transition but not the second.
The static gate derives `sourceUnitReplayEligible: true`,
`threeStageEpisodeEligible: false`, and
`stageSpecificEvaluatorRequired: true`; a final-PR test bundle is not
automatically a transition-specific three-stage evaluator. The projection has
no raw execution witness and does not authenticate the local Docker daemon, so
it freezes the canary inputs/results without independently proving that the
recorded live execution occurred.

This also exposed a mismatch between historical review trajectories and the
then-current C6 contract. Before the stage-scoped replacement, `dataset.ts`,
`c6-dataset-lineage.ts`, `c6-flat-summary.ts`, and
`c6-candidate-plan.ts` bound one sealed prehistory and one summary to the whole
episode, while a real review sequence has a growing prefix. Reusing the
maximal prefix at every stage leaks future history; reusing the minimal prefix
omits the context that later review requests depend on. Treating
experimental-arm output as the prefix would instead reintroduce longitudinal
carryover and break the frozen-prehistory causal comparison.

The deterministic preflight had to complete a clean stage-scoped sealed-prefix
replacement before T001 episode intake:

1. every stage binds its own immutable upstream-history artifact and source
   units;
2. a later prefix may extend an earlier prefix, but current/future target,
   hidden-test, and gold material remain forbidden;
3. every arm starts that stage from the same repository snapshot and upstream
   prefix, while the Codex process and GoodMemory store remain fresh;
4. no patch, transcript, Stop result, or writeback produced by an experimental
   arm becomes input to any later stage;
5. flat-summary is generated once per distinct non-empty stage-history binding
   before arm execution and reused across the three seeds, not incorrectly
   reused across different prefixes; no-history controls generate nothing;
6. every historical transition has a separate fail-before/pass-after evaluator
   plus protection tests; one final test bundle cannot stand in for all
   transitions;
7. the full episode-wide leakage matrix checks every prefix and summary against
   current and future hidden/gold closure.

Implementation checkpoint (2026-07-25): dataset schema v3, the stage-prefix
helper, lineage v2, summary protocol/artifact v3, candidate-plan v6, leakage,
gate-policy v4, readiness, CLI, and the end-to-end fixture now implement the
structural clean break. Lineage loads each actual history artifact, requires
its record count to be covered by ordered source units, and binds per-stage
history/materialization/target evidence plus stage and episode closure hashes.
It also rejects drift in the actual frozen-history JSONL prefix. Summary
generation is restricted to distinct non-empty stage-history bindings.
No-history controls require canonical zero-byte history and zero source units,
invoke no provider, write no summary artifact, and inject zero text in both
treatment arms. The original structural-clean-break checkpoint passed 125/125
tests with 1923 assertions; later schema-v6 focused counts are recorded in the
current status and task board. This completes
readiness-ladder step 1 while deliberately claiming only deterministic
byte/count/hash/protocol closure; it does not semantically rebuild upstream
events, authenticate the source platform, or create accepted episodes.

This changes summary-generation budgeting from exactly one per episode to at
most one per non-empty scored-stage history, with exact reuse determined by
the frozen stage-history hash. It does not change the 10557 Codex stage-call
floor.
Thresholds, repository inference, three-arm ordering, and positions-two-and-
later headline aggregation remain unchanged. The replacement must land through
schema-versioned TDD before any expensive summary or Codex call.

Actor-correction checkpoint (2026-07-25): the prospective structural source
frames were found to use a suffix-only bot test. That rule did not exclude
accounts such as `coderabbitai`, `copilot-pull-request-reviewer`, or
`github-actions`, and filtering only the already-selected sequence would have
been invalid because removing a thread head can promote a later comment.
The old frame-v2/v3/v4 candidate projections and the 42-row semantic ledger
therefore remain immutable provenance, but they are not inputs to the
actor-qualified candidate truth and their semantic decisions cannot be reused.
Rank 43 in that old order is not the next actor-qualified review.

The correction freezes every raw review/comment author for all broad targets,
captures current GitHub `/users/{login}` responses, filters before
thread-head selection and legal-sequence search, and then replays the complete
raw GraphQL event set. The frozen actor policy requires HTTP 200, matching
login, platform `type: User`, and exclusion by a frozen known-automation-login
list; 404 and non-User responses fail closed. This proves only current
platform-user qualification under that policy. It does not prove a human
reviewer, the actor type at event time, complete automation exclusion, or a
cryptographically signed GitHub receipt.

The three actor closures and corrected qualification artifacts are:

- Multi-SWE: actor-plan SHA-256
  `bce46b39f3a7b0a5ee85e7f01f89499cf4a6ca890ad17324ed04f5c8e4cd66bb`,
  actor-root
  `64dfe87f0b8d2cf182c48f9a578c90e6b45b48e84aa865db88e049054293353c`,
  qualification
  `69e6417308279fb398cdec5abdf7b41e77d501097830264a502175815e8e98f8`,
  with 44 actor-filtered exact and seven no-exact targets;
- SWE-bench Multilingual: actor-plan
  `33ebb779b1c8088710d9742958f8fee4d98d6faa4fe5e0150e29f576d0adc48a`,
  actor-root
  `1131f3ac5faaa9b646481fd9e9388ceb5f1fc24611285998556b3d86dc1932c7`,
  qualification
  `7fb942cd87126d360ed820e91cf8bee1073153cd21c674eeb91d3cb09b05929f`,
  with 19 fresh exact, three actor-requalified old-frame overlaps, and four
  no-exact targets;
- SWE-bench Live/MultiLang: actor-plan
  `93e38720b06aec7fbf2a6465bfa1d4c7fba9358d5fbcaa9c4638fbd6cab54051`,
  actor-root
  `770ce9a162fcc1736d7397e0d564c7c7085df8ad2ce35177217c2de2d442b23e`,
  qualification
  `728453138ee33e6b6e5525ea6e3555c998d9f17774afed8da18c8ff845283a66`,
  with 47 actor-filtered exact and 17 no-exact targets.

The new prospective-only frame has SHA-256
`6838de7f36875b3b3de104ffd896b9e30dcf95ad1eb285a87b465789800f4b0c`
and candidate projection
`1d0c5689521aa906e7fb2bf015579bbcc7638b31093966edec5339724aec82af`.
Its frozen order is Multi-SWE capture order, then Multilingual capture order,
then Live/MultiLang capture order. It contains 113 structural candidates
across 57 repositories, no cross-tranche duplicates, and a repository-cap-4
ceiling of 93. This is enough for the current 72-candidate semantic-screening
buffer, not the C6 headline dataset. The artifact itself records the
391-episode floor, raw shortfall 278, repository-capped shortfall 298,
`headlineRawStructuralCandidateFloorMet: false`, zero accepted and
machine-qualified
episodes, `candidateManifestFrozen: false`, and `codexRunReady: false`.
The cap-4 number is a conservative screening-diversity diagnostic, not a
freeze-time repository-allocation rule; the final repository-family
allocation still requires the separate outcome-blind power/precision artifact
already mandated by the C6 plan. The raw 278 shortfall is independently
decisive.

The first outcome-blind supply-expansion action is now frozen before any
neighbor response is captured. The Live/MultiLang neighbor-census plan is
SHA-256
`1b07d57ebc5601b9ab7f6742fdb5da91b9181784d7b2a33bf28ad318fa2e10f1`;
its selected-repository projection is
`dee7643fa9693c4b43cb56f985d7cf7aded9ed4de3c8fc6c62c0def428a0fe0e`.
It reconstructs 743 existing anchors, 381 requested repositories, and 380
canonical repositories from the frozen GraphQL closure; excludes all 37
canonical repositories already represented in the current actor-qualified
frame; and leaves 343 eligible repositories. The plan takes the earliest eight
repositories in each frozen split (`c`, `cpp`, `go`, `js`, `rust`, `java`,
`ts`, `cs`) and rotates by within-split rank, yielding 64 repositories with a
cap of 16 recent merged PRs each. The resulting 1024 is only a maximum raw
anchor census size. The plan consumes no patch, test, gold, outcome, semantic,
or machine decision and records zero semantic/machine qualification and zero
accepted episodes. Its 5/5 focused tests pass with 14 assertions, and a real
external-closure rebuild is byte-identical.

The frozen metadata-only network census has now completed all 64 repositories.
Its external 257-file root is SHA-256
`79d7d23097ec1ee11082a7b01a8f36d59383b3e2cf5d536630b29fde7a9400c4`;
completion SHA-256 is
`68727cb0aefb04a3f9b84f8e67a41f9aaba952665e2fef798f61110e36352b53`.
Every repository had more than 16 merged PRs, so the frozen newest-16 rule
produced 1024 raw anchors and 64 explicitly truncated repository histories.
The capture query requested only identity/time/commit/author and
review/thread/comment counts, persisted a redacted canonical request and raw
response per repository, and retained zero accepted or qualified episodes.

Qualification artifact
`swe-bench-live-multilang-608f7ae9.neighbor-census-qualification-v2.json`
is SHA-256
`e51243ea3aa740a3a0812f8c1289ac2d3cf51436440ae0ecfea67a280743f1cc`
with deep-target projection
`f45d9ef61b55d73d2b94c8018d7874ae58887fa01133a4fd77883f0548701404`.
It byte-replays the source capture plan from source-pool SHA-256
`8c53bcb359a6cde71207a69ca5b8630d6ea299f3fdc7219db958f86cb499e4ec`
and the neighbor plan from actor-frame SHA-256
`6838de7f36875b3b3de104ffd896b9e30dcf95ad1eb285a87b465789800f4b0c`,
then rebuilds all 743 old canonical anchors, removes three overlaps, and
classifies 1021 novel anchors: 692 have a whole-review or review-thread surface
and require deep capture; 329 do not. Initial and terminal verification reject
untracked root entries, including `asset-lock.json` and empty directories.
Ordinary issue comments alone are not review evidence. This is a merged-only,
recency-capped, adaptive convenience sample using post-merge structural
metadata, not a representative population or candidate-capacity claim.
An independent rereview accepted qualification v2 with no P0/P1 after
byte-identical real-root replay and terminal asset-lock, empty-directory,
ordinary-file, self-consistent source-pool, and self-consistent actor-frame
mutation probes. The explicit quality gate passes 3/3 with 14 assertions on
the two external roots.

The resulting deep-capture plan is SHA-256
`9c1ebdafd700a274cffc4dba807a2425013079d1bfe74a1e99f1144399da492a`
and binds all 692 pretargets across 61 repositories to qualification v2. It
requests only review/review-thread structural surfaces and their bodies plus
commit-parent topology; it explicitly excludes PR/issue title/body,
discussion comments, files/diffs/patches, tests/gold/checks/outcomes, and
commit messages. Its minimum request count is 692; pagination volume is not
yet known. Independent review accepted the plan with no P0/P1/P2, and the
initial query executed successfully against one real frozen target with no
GraphQL error; this is not a 692-target execution claim. The four focused
plan/capture/qualification/deep-plan suites pass 23/23 with 384 assertions.
The subsequently hardened paginated runner was independently accepted with no
P0/P1/P2 after terminal asset-closure, transport/body/timeout retry,
rate-limit/transient-GraphQL retry, nullable timestamp, identity drift, total
count drift, and publication mutation probes. The exact accepted runner then
captured all 692 targets. The external 2772-file root is SHA-256
`80c360d58b1959e5a47cbd70c5eb620276ed2105c49a595dccdb4aa178d1f83b`;
completion SHA-256 is
`62ba6ada2d0ae54f4d43149e592ec06b70899e712a12f97dd503d8650ff2063d`.
There were 693 logical and 693 network requests: one target required a second
commit-connection page, while all other connections closed on their first
page. Independent replay verified 4919 complete connections, every
collected/declared total, every persisted raw-response hash/byte count, all
HTTP statuses as 200, zero GraphQL or transport errors, no symlink or mode
drift, a byte-identical terminal asset-root rebuild, and no exact GitHub-token
occurrence. This proves capture completeness for the frozen structural
surfaces; it does not yet prove structural eligibility, actor chronology,
semantic dependency, evaluator validity, or any accepted episode.
An independent deep-evidence replay loader was then accepted with no
P0/P1/P2. It revalidates the complete 2772-file/2771-directory closure, all
692 manifests, all 693 final-success responses, cursor/total/node identity,
retry provenance, and terminal path/mode closure without trusting manifest
totals. The frozen replay contains 2009 commits, 2137 parent edges, 1848
reviews, 834 review threads, and 1337 thread comments. It also retains all
3185 non-null review/comment actor occurrences across 267 unique reviewer
logins, plus 692 separately bound pull-author occurrences. Those are raw
structural and actor inputs only; no structural, actor, semantic, evaluator,
or episode acceptance follows from the counts.

The first tranche cannot reach the frozen 391-episode floor under the
repository-cap-4 screening diagnostic even in the impossible best case where
every deep target survives every later gate: its 61 new repositories contribute
at most 244 rows, and the current actor-qualified frame contributes at most 93,
for an absolute ceiling of 337 and a shortfall of 54. This arithmetic uses no
wave-one deep response, semantic decision, evaluator result, or Codex outcome.
Consequently, before any wave-one deep outcome was observed, a second
metadata-only repository tranche was frozen. The continuation census plan is
SHA-256
`1de54a4da9087502213022ccdf0703f007158ecaca4ef1dd5f51af2a93591aab`
with selected-repository projection
`d613a9d8c2eac5e14cb3646eab384e60856fb141bf5218f193a6ae9476de5d79`.
It byte-rederives the accepted ranks-1-through-8 plan, excludes those 64
repositories and the current actor-frame repositories, and selects ranks
9 through 16 in each of the eight frozen language splits. The result is 64
additional unique repositories, 279 still-eligible repositories after the
first tranche, and a cumulative metadata-census ceiling of 2048 raw anchors
across 128 repositories. An independent review accepted the selection plan
with no P0/P1; real-root replay was byte-identical and confirmed zero overlap
with both the prior tranche and actor frame. Its explicit gate passes 3/3 with
24 assertions, including terminal prior-plan drift and recursively nested
hidden-gold mutations.

Both live executors were hardened with failing mutation tests and then received
fresh independent acceptance with no P0/P1/P2. Before observing any wave-one
deep result, the exact continuation runner captured all 64 planned repositories
and 1024 raw anchors. Its external 257-file root is SHA-256
`9624c9db465e53af12ba9ee385b334e1f24a965c61361d2a2e9963e18e6596ed`;
completion SHA-256 is
`684abebb2c7a496fffc535495af780276778443b9798cbf427dd60a2993301f5`.
Independent replay found the expected 64 target directories, no untracked
entry/symlink/mode drift, a byte-identical terminal asset-root rebuild, correct
prior-plan bindings, and no exact GitHub-token occurrence. The immutable
continuation plan still truthfully records its preregistration-time
`censusCaptured: false`. The separate continuation qualification is frozen at
SHA-256
`011c264e496fb849a1f14baee1289cb815e90bd81adfa4f6bec44d08b11030ef`
with deep-target projection
`d4aefe655c93875656c48e789af96801ba02a98edb423d6da8303ef8ddc1dbe6`.
It independently byte-rebuilds the source plan, first-tranche plan, and
continuation plan; consumes only the second tranche; and classifies 1024
canonical pulls into six existing-source overlaps, 643 deep-capture
pretargets across 60 repositories, and 375 novel pulls without a review
surface. Its terminal closure pins the source and continuation trees with
their distinct real mode profiles, and its no-replace materializer replays the
full closure after publication. Independent review accepted the exact
implementation with no P0/P1/P2, and the explicit external-root gate passes
2/2 with 10 assertions. Until the later deep/structural/actor/semantic/
evaluator closures pass, both tranches still contribute zero accepted episodes,
`candidateManifestFrozen: false`, and `codexRunReady: false`.

The continuation deep-capture plan was then independently accepted after
inode-bound publication rollback mutations and frozen at SHA-256
`9af58b2033aa67d8bb1d056ff0f56fe8db9c1b0c7a75f73ed1a6a784ad0f4472`.
It preserves all 643 pretargets across 60 repositories and has target
projection
`9b1249a93f2878c41d258cdb2212facf26e4c810f2ed7322d1fcd23fe867eacf`;
its explicit gate passes 1/1 with 11 assertions. The live run correctly
failed closed before publication at target 257,
`mbed-tls/mbedtls#10815`: GitHub reported 308 pull-request commits but ended
the paginated pull-request commit connection after 250 nodes. No Wave2 deep
root was published. A separate outcome-blind diagnostic queried
`commits.totalCount` for every one of the 643 frozen targets in original
order and found exactly one target above the platform surface limit: that
same 308-commit pull. The protocol will therefore freeze a complete
643-target commit-count eligibility closure, apply one uniformly frozen
`totalCount <= 250` transport rule, and derive a 642-target plan without
replacement sampling. This rule was fixed after the failed plan-v2 attempt
and exploratory all-target count diagnostic, but before the canonical
capture; it must not be described as preregistered before exploration. It
must not label the truncated 250-node connection complete or use REST compare
responses that would introduce files/patches into this structural-only
capture boundary.

That formal closure is now executed without changing the rule. The 643-target
plan is published at
`fixtures/codex-coding-effect/c6-source-pool/swe-bench-live-multilang-608f7ae9.neighbor-commit-count-eligibility-plan-v1.json`
with SHA-256
`eebd85d07feb0346455bcdba1cc4a180346b2e8473191008647653bd4aea301a`;
its exact-byte gate passes 3/3 with 21 assertions. The canonical capture
published 643 logical and 643 network requests, asset-root SHA-256
`5525d57c663351f8c3c2724822d9d68c39fc78bc1c145357223ec0a8b69f4182`,
and completion SHA-256
`e2fc07337ea01cfb1c5a1879dc9d3a5638d92c250b881e8d5520cbc6141045db`.
The asset closure independently rebuilds exactly and contains 2573 locked
files. Its completion records 642 within-cap targets and one excluded
target, `mbed-tls/mbedtls#10815` at 308 commits. The strict raw-response
qualifier is now published at
`fixtures/codex-coding-effect/c6-source-pool/swe-bench-live-multilang-608f7ae9.neighbor-commit-count-eligibility-qualification-v1.json`
with SHA-256
`3c5f0fdece74c51174c47eef4dd8bffd404675f015adb314005e1ae13b7631d9`.
It replays all 643 request identities and raw final responses, derives the
642/1 split without trusting the completion decision, and preserves zero
replacement or resampling. Its external-root gate fails when the root is
absent and passes 1/1 with eight assertions when bound to the canonical
closure. The no-replacement 642-target plan-v3 is frozen at SHA-256
`a0dd0fa0a106d6d1e65645dcec9e44f9e04eb08d7f47e59d25f37920d7cae411`
with target projection
`368b631cf31c614fe1806f927cd5a4f0959ed3ef8bdc8823408b1f03dc6f8339`;
its exact-byte gate passes 1/1 with ten assertions. These are transport
eligibility results, not episode acceptance.

The plan-v3 Wave2 deep capture then completed all 642 targets with 644
logical/network requests: two neighboring mbedTLS pulls required a second
commit page, every attempt succeeded on the first network try, and no other
pagination was required. The external 2575-file/2573-directory closure has
asset-root SHA-256
`85b3d8db9ef328c3c0bb29025da6b428552435d1188c53dd8aa4b1a4b1f46ea1`
and completion SHA-256
`63b203ec0bd52765e1fedcf980f2cc7cb74d899c004b2ec7499eabfb94b0a939`.
Independent replay accepted the complete request/cursor/asset closure and
found 1612 reviews, 649 review threads, 1089 thread comments, and 2701
review/comment actor occurrences across 256 normalized logins. Applying the
already frozen structural-review-v2 policy produces only 22 exact pre-actor
sequences across 16 repositories and 620 no-exact rows. That deterministic
single-wave qualification is frozen at SHA-256
`9dc625cbfb5c1c0bc47f9b09511b9ce7c8df789bf4bcbaafa2d8d182dd88be91`;
its external-root exact-byte gate passes 1/1 with eight assertions. Wave1 and
Wave2 therefore contain 56 exact pre-actor rows in total, not 1334 episodes.
The local canonical two-wave union is now materialized at
`fixtures/codex-coding-effect/c6-source-pool/swe-bench-live-multilang-608f7ae9.neighbor-structural-union-v1.json`.
It contains all 1334 source-ordered rows, 5886 reviewer occurrences, and 507
cross-wave-deduplicated normalized reviewer logins; its 2,597,956 canonical
bytes have SHA-256
`3a438e999450b96c039dbea6eba7ae971bb03223c42c2b2ff502f85ed76ad208`.
Its external-root gate rebuilds both child qualifications from their raw
closures, compares both child artifacts and the union byte-for-byte, and
passes 1/1 with 18 assertions. Independent review found no P0/P1; its one P2
rollback error-propagation finding was reproduced by a red test and fixed, and
the focused union suite now passes 9/9 with 40 assertions. This freezes a
pre-actor structural union only. It does not turn the 1278 no-exact rows into
candidates, apply actor policy, accept an episode, or make Codex run-ready.
The complete union-wide lookup plan is now materialized at
`fixtures/codex-coding-effect/c6-source-pool/swe-bench-live-multilang-608f7ae9.neighbor-reviewer-actor-plan-v2.json`.
It has 507 targets, target-projection SHA-256
`68ac8d1823039f7375dc6903676ed146b3704511c4bb79bd077a15d38bc5b53c`,
and 86,991 canonical bytes with SHA-256
`9603ab1f3ccf52efb632ca090a0a87b4235dad178f85d1f9b7ecb976b9d0dc17`.
The plan is deliberately policy-neutral: it records that no actor-eligibility
decision was input or applied and that policy binding is deferred until the
complete identity capture exists. Its gate rebuilds both external structural
closures, both child qualifications, the union, and the plan, then compares
the canonical artifacts byte-for-byte; it passes 1/1 with 24 assertions.
The plan suite passes 10/10 with 35 assertions. The capture runner now
dispatches schema-v1 and schema-v2 plans explicitly and preserves historical
v1 classification while leaving v2 policy-neutral. Its focused suites pass
30/30 with 622 assertions, typecheck passes, and independent review found no
P0/P1/P2.

The real 507-target current-platform identity capture is complete at
`/private/tmp/goodmemory-c6-live-multilang-neighbor-reviewer-actor-identities-v2`.
All 507 requests completed on attempt 1 with zero retries. Independent replay
rebuilds asset-root SHA-256
`4ff26b0d9dd69900f750c8699d30ff588ec9a82eaff73ea4954e8c3db23f5842`
over 2029 files / 1,883,615 bytes and 1015 directories; every file is mode
0600, every directory mode 0700, and there are zero symlinks, special nodes,
missing/extra entries, or shared inodes. Canonical `capture.json` is 159,104
bytes with SHA-256
`a3695941b1d7d12fdaf6d08df46023176ff10e1f12b4f833d3e1ee391a95b2c5`.
The root records 500 resolved and seven unresolved actors: 493 current
`User`, seven `Organization`, and seven null/404. Every request/response/header
reference, URL, redirect flag, required header, 200 login identity, and 404
body schema replays exactly. The tree contains no policy, eligibility, or
reason fields, and token-pattern plus exact runtime guard evidence is clean.
This accepts only the raw transport/current-platform closure. Actor policy,
human identity, event-time type, selection, and accepted episodes remain
unproven.

The union-wide post-capture policy-v3 classification is now materialized
locally at
`fixtures/codex-coding-effect/c6-source-pool/swe-bench-live-multilang-608f7ae9.neighbor-reviewer-actor-derived-classification-v3.json`.
Its 225,600 canonical bytes have SHA-256
`7b8a812b7740ce2703eee470b01043fce8f8a64a120dca5ebc11f8226920696b`.
It replays the complete 507-target plan and 2029-file raw closure, sanitizes
only capture order/login/status/current platform type, and records v2
487 eligible / 20 ineligible versus v3 486 / 21. The only changed decision
is `joestump-agent`, excluded by the new general case-insensitive `-agent`
suffix rule. The artifact explicitly records that this rule was adaptive
after the complete actor capture and that its reviewer-login population is a
projection of the structural union; it does not falsely claim independence
from that projection. Focused tests pass 13/13 with 58 assertions, the
external-root exact replay gate passes 1/1, and final independent code/raw
review found no P0/P1/P2. This still is not an accepted actor-selection
closure: the artifact keeps durable independent-review receipt and commit
ancestry false, actor-filtered selection false, accepted episodes zero, and
`codexRunReady: false`.

Wave1 pre-actor structural qualification is independently accepted and
frozen at SHA-256
`ae096d86f779cb04f1fb0bb336d6bb4e02ced04e72385d9332d4dba82a9c1210`.
Its explicit gate passes 4/4 with 30 assertions and byte-rebuilds the full
external closure. Of 692 targets, 34 have an exact pre-actor structural
sequence and 658 do not; there are 830 projected structural events, 3185
review/comment actor occurrences, 267 normalized reviewer logins, and a
repository-cap-4 diagnostic of 30 across 15 currently exact repositories.
Actor filtering has not run and can change thread-head selection, so 34/30
are neither actor-qualified yield nor a final supply ceiling. Accepted,
semantic, evaluator, and machine-qualified episode counts remain zero.

The complete Wave1 reviewer-actor lookup plan is now frozen from all 3185
review/comment occurrences rather than from the 34 pre-actor exact rows. It
contains 267 normalized GitHub logins, has target projection
`8393f1a04a25b3288932b954ab5825ec8ceca37f57dd3d3da8dc9bdd7ac62205`,
and is published at
`fixtures/codex-coding-effect/c6-source-pool/swe-bench-live-multilang-608f7ae9.neighbor-reviewer-actor-plan-v1.json`
with SHA-256
`abb0a817611c7f5568c0f3390625598a46a1a56c687617815260ee98121a92d3`.
Its explicit exact-byte gate passes 4/4 with 27 assertions. This freezes only
the lookup population and request order; no actor identities have been
accepted and no actor-qualified episode count exists yet.

The complete current-platform actor capture is now published locally with
asset-root SHA-256
`f92953b8a0cfbf10e41a54c6912b67541a847c1b11b7b57dc7d5cb647b1a4ab4`
and root-manifest SHA-256
`ec047aba9c5e862193627d814432bd2d29d9387505de56c1e834891aba511f51`.
All 267 targets completed on one network attempt; the 1069-file closure
records 260 resolved and seven unresolved actors. Policy v1 classifies 254
as eligible and 13 as ineligible, but this is not yet an accepted actor
closure: several obvious automation-style `type=User` logins remain eligible
(`cubic-dev-ai`, `esphbot`, `gemini-code-assist`, `greptile-apps`, and
`mentatbot`). The minimal outcome-blind policy-v2 audit adds only a general
`endsWith("bot")` rule plus exact exclusions for the other three known
accounts. Its derived classification is frozen at
`fixtures/codex-coding-effect/c6-source-pool/swe-bench-live-multilang-608f7ae9.neighbor-reviewer-actor-derived-classification-v2.json`
with SHA-256
`739193f348ee15852e9f337a009233dab3bde3479ea85aa2b73299960280cebc`.
It binds a strict 267-row
`captureOrder/login/status/currentPlatformType` projection, changes exactly
five decisions, and yields 249 policy-pass / 18 ineligible actors. Its
external-root gate passes 6/6 with 33 assertions. It still truthfully records
`independentReviewCompleted: false`, `commitAncestryProven: false`, and
`actorFilteredSelectionExecuted: false`: code review accepted the derivation,
but no durable independently dispatched review receipt or freeze-commit
ancestry exists. The capture and policy still do not prove GitHub
cryptographic provenance, event-time actor type, complete automation
exclusion, or human identity, and policy-v2 cannot yet feed selection.

The explicit actor-qualified Phase-73 gate replays all three actor closures,
their raw source roots, the corrected qualifications, the new frame, and the
unchanged old frame-v2/v3/v4 hashes; it passes 1/1 with 18 assertions on the
current machine. A mutation test now proves that an ineligible thread head is
removed before a later eligible comment is selected, and the Multi-SWE REST
adapter revalidates actor plan/root after its terminal hook so those inputs
cannot change between projection and publication. The gate still depends on
eight external raw roots under environment variables and is not repo-only
reproducibility. T001 must next expand the actor-closed, outcome-blind source
supply above 391 with rejection headroom before final semantic/machine intake;
it must not resume the superseded rank-43 ledger or start Codex calls.
Even before actor filtering, the current structural supply is only 169 rows:
113 from the earlier source frame plus 34 Wave1 and 22 Wave2 rows. Its
repository-cap-4 diagnostic is at most 145 (93 + 30 + 22), leaving raw and
capped shortfalls of 222 and 246 before semantic/evaluator attrition. The
1334 deep pretargets cannot be counted toward the 391 floor.

##### C6-T001c historical: source-v3-simple promotion and stopped observation

The Wave1/Wave2 supply data rejects a third copy of the current sampling
shape. Wave1 produced 34 exact pre-actor rows from 692 deep pretargets;
Wave2 produced 22 from 642. The combined deep-to-exact yield is 56/1334
(4.20%), and repository cap 4 retains 52. Another 1024-row metadata tranche
at the historical total yield would add only about 28 exact rows and roughly
24 cap-retained rows. It cannot close a 246-row capped shortfall, even before
actor, semantic, evaluator, Linux, duplicate, and license rejection.

An exploratory metadata analysis found one useful prospective candidate rule:

```text
novel canonical repository and pull request
AND reviewCount >= 4
AND reviewThreadCount >= 2
AND commitTotalCount <= 250
```

The first two count thresholds selected 170/2048 existing metadata rows and
contained 49/56 exact structural rows: 29/96 in Wave1 and 20/74 in Wave2.
This is an exploratory result discovered after both waves were observed;
Wave2 is not a holdout. The rule may therefore be frozen only for unseen
Wave3 rows before any Wave3 deep body, actor identity, structural result,
semantic decision, or evaluator result is captured. It must never be used to
retroactively select Wave1/Wave2 rows. Language, repository name, historical
yield, rank, title/body, review body, diff/files, commit message, tests, gold,
actor type, or downstream outcome are forbidden selection inputs.

The retrospective proposal is materialized locally at
`fixtures/codex-coding-effect/c6-source-pool/swe-bench-live-multilang-608f7ae9.wave3-pretarget-policy-v1.json`.
Its 9,105 canonical bytes have SHA-256
`eb3df63ff269b1d0166ed4b2faba682d60cdce3fb1ea64946e66f08e5eda9856`.
It exact-binds the two metadata qualifications, two structural
qualifications, and their union, then independently replays the 96/29,
74/20, and combined 170/49 threshold observations. The executable selector
uses a strict default-deny DTO: only review count, review-thread count, and
commit total count can affect thresholds; anchor/repository identities are
role-scoped to novelty/deduplication (and later repository-cap grouping), and
anchor/repository cross-identity must match. Extra language, rank, status,
yield, body, outcome, gold, or downstream fields fail parsing. Focused tests
pass 7/7 with 63 assertions, the repo-only exact gate passes 1/1 with six
assertions, and final independent review found no P0/P1/P2. This is still a
proposal, not a preregistration: the artifact keeps independent review,
commit ancestry, preregistration, selection, accepted episodes, and
`codexRunReady` false until a separately durable review/freeze chain exists.

The current C6 estimand is explicitly limited to one frozen public-GitHub
convenience cohort. It does not claim that the cohort represents all coding
work. Unpredictable random order is therefore not a scientific prerequisite
for the paired treatment contrast. What matters before any Codex outcome is
observed is a finite source frame, complete enumeration, outcome-blind
qualification, immutable allocation, and no redraw.

The historical recovery protocol was `source-v3-simple`. It exact-references the
existing 631,004-byte source-v2 artifact but inherits only its `exclusions`,
`inputPolicy`, `repositoryUniverse`, and `searchProtocol` sections, plus the
exact 9,105-byte pretarget predicate already referenced by source-v2. Its
469,987-byte inherited projection has SHA-256
`efb76e58585c6c422020954783eee50e37290d94f78310bd88c176929fa85474`.
The source-v2 activation and anti-grinding sections are explicitly
superseded; Quicknet, Ethereum, caller salt/nonce/round, quota stopping, and
redraw were not inputs to that protocol.

The 3,992-byte canonical proposal is materialized at
`fixtures/codex-coding-effect/c6-source-pool/swe-bench-live-multilang-608f7ae9.source-v3-simple-protocol-v1.json`
with SHA-256
`5f989ab640c684dac287142edc9d2f9d8ee46099c082f63bb20f2a9546205132`.
`c6-source-v3-simple.ts` rebuilds it only from the exact source-v2 bytes,
strictly parses canonical JSON, and rejects source drift and unknown
authorization fields. Its focused replay passes 3/3 with 15 assertions, its
exact non-authorizing quality gate passes 1/1 with 11 assertions, and
typecheck passes. At creation this was a protocol proposal, not a capture
receipt or preregistration; it is now a historical artifact.

The protocol requires:

1. independently review the exact proposal bytes and freeze them in a commit
   that is an ancestor of the formal census implementation; the later
   promotion receipt must bind protocol bytes/hash, review
   request/input/dispatch/response/provenance, reviewer separation,
   commit/tree/parent ancestry, verifier source, and the prior-repository
   node-ID exclusion closure;
2. enumerate all 1,536 frozen root shards in canonical ID order; ordering is
   operational only and never decides inclusion;
3. recursively split every GitHub Search interval above the accessible
   1,000-result cap, fail on an unsplittable over-limit second, and retain the
   complete count tree;
4. capture every normalized repository-node projection twice and require
   equality, then enumerate every in-window merged pull request for every
   frame repository twice through connection exhaustion or the frozen lower
   bound;
5. retain one complete accepted/rejected ledger for every census row. No
   quota-driven stop, downstream-yield stop, adaptive frame expansion, caller
   order override, redraw, replacement, or silent source mutation is allowed;
   the future census receipt must bind complete count-tree/leaf coverage,
   request/response/cursor/terminal page closure, normalization source hashes,
   two-pass row-set hashes, exclusion closure, every metadata decision, asset
   lock, and terminal input replay;
6. stop at the source-row ledger. This artifact does not define episode edges,
   stage triples, task/history projection, relationship qualification, or
   final candidate allocation and cannot authorize any of them;
7. before candidate selection, separately freeze an exhaustive edge/stage-
   triple construction protocol, raw-row projector and per-edge relationship
   review, plus the already required outcome-blind repository-family
   power/precision allocation artifact;
8. only those later gates may enforce the exact 391 three-stage episodes,
   eight 48-episode stratum floors, 48 real-history floor, and the
   independently justified repository-family allocation. The cap-4 value
   remains a screening diagnostic, not the final allocation rule;
9. if source supply or any later frozen diversity/power floor is insufficient,
   fail this evaluation ID. A larger source frame is a new protocol and
   cannot be introduced as a continuation draw.

The frozen proposal deliberately reports `acceptedEpisodeCount: 0`,
`formalCensusPermitted: false`, `sourceV3SimpleFrozen: false`,
`candidateManifestFrozen: false`, and `codexRunReady: false`; those fields are
historical proposal state and are not rewritten. The separate asset-bound
review and freeze-ancestry gate was later closed by freeze commit
`ba4cee1e668adff0354b23dd743ae44e23e42af9`, strict descendant
activation/base `cc42f0bbd673b6595a6c82b3c5cb995a8efbe826`, and the promotion
receipt described below. That promotion validly granted census-entry authority
at the time, but the later RF5 runtime observation was stopped with terminal
disposition `abandoned-infeasible-observation` and `not-promotable`. It cannot
be resumed, topped up, or reinterpreted as a completed source-v3 census.

The original source-universe v1 proposal is materialized at
`fixtures/codex-coding-effect/c6-source-pool/swe-bench-live-multilang-608f7ae9.wave3-source-universe-v1.json`.
It has 841,425 canonical bytes and SHA-256
`ffa3d50be892d7b80d987f68a72bcfd639392f67cbd173350987944beb594c9c`.
Its separate 491-byte activation-salt proposal input has SHA-256
`66793fb6426c5719feb6fca61f75fa38dd0d02ce2a927c61135f34cda4725e71`.
The source proposal exact-binds the 1,447-anchor / 178-repository exclusion
projection, 1,536 root shards, three salted key domains, cap 4, the single
terminal quota, and direct two-pass PR connection protocol. Focused tests
pass 11/11 with 1,626 assertions, its repo-only exact rebuild gate passes
1/1 with eight assertions, typecheck passes, and final independent proposal
review found no P0/P1/P2.

That v1 is deliberately retained as an auditable, non-authorizing historical
proposal. Its local literal salt cannot be retroactively proven first-only, so
v1 is not promotable and will not receive a compatibility path.

The historical replacement salt-independent source artifact is materialized at
`fixtures/codex-coding-effect/c6-source-pool/swe-bench-live-multilang-608f7ae9.wave3-source-universe-v2.json`.
It is 631,004 canonical bytes with SHA-256
`822c458e792ee31f7738cae2526b05dfc3b63fcaac58e3f4f87dcd3803ccdba1`.
It independently rebuilds the same 1,447-anchor / 178-repository exclusion
projection and 1,536 shards from the policy, prior frame, and structural union;
v1 and its salt artifact are not inputs. It contains no `publicSaltHex`,
`activationKeySha256`, or `activationOrder`. It freezes only the future
commitment-bound activation-salt KDF, no-tier terminal quota, cap 4, current
GitHub census protocol, complete Quicknet chain profile, exact
earliest-round-not-before arithmetic, and the requirements for exact-round
signature/randomness verification.

Focused v2 tests pass 10/10 with 3,146 assertions, its repo-only exact rebuild
gate passes 1/1 with 12 assertions, typecheck passes, and final independent
proposal rereview found no P0/P1/P2. This remains a proposal, not capture
authorization: its concrete witness provider is unfrozen, the provider and
BLS verifiers are absent, exact C0 evaluation identity/ancestry and
authenticated review receipts are absent, prior repository node-ID closure is
false, and `requireC6Wave3OfficialCaptureAuthorizationV2` always throws.
Within that superseded design, Sigstore/Cosign could supply strong blob,
RFC3161, identity, and inclusion receipts, but Rekor search was not a complete
first-write namespace and a Sigstore bundle alone could not unlock the salt
or Wave3 Search.

The non-authorizing prior-178 identity plan is now materialized at
`fixtures/codex-coding-effect/c6-source-pool/swe-bench-live-multilang-608f7ae9.wave3-prior-repository-identity-plan-v1.json`.
It is 76,257 canonical bytes with SHA-256
`70b202cd6da6c2c504a0c23168dc9bcb6a73e9697ff98884dcc83ca785cd4ee2`.
It freezes 178 requested repositories into complete pass A then pass B, for
356 logical lookups, without containing captured repository node IDs. Its
historical source-v2 formal capture/qualification paths remain permanently
unavailable and receive no compatibility authorization path.

The historical `source-v3-simple` evidence path is separate from those
source-v2 authorizers. Two operator-observed executions each completed 356
successful logical lookups with no retry. Capture A and B each contain 356
unique final request IDs with zero cross-capture intersection and resolve the
178 requested repositories to 178 node IDs. Their repository-identity and
canonical node-ID/alias-dedup projections are byte-equal. The canonical
4,769-byte replay receipt has SHA-256
`903912db14ed999cd19f32ffaef81658bc241daf8be9e2f33aa14b1784b94d0a`;
its repository projection SHA-256 is
`05f0f541bfdbca903d93b8de0c1beabcc5255feedbb99ccfa224e0a30e485191`,
node-ID dedup projection SHA-256 is
`c1d0d92294306042872f73a7e98acd7a64cd6aa82c01ef2cdd81bcf2620e4076`,
and combined request-ID projection SHA-256 is
`ef161f837bb07cc8979bfe257842df31e4c6dee57e42b3589df85d02fd59c1e9`.
It deliberately keeps live-network proof, external authenticity, independent
capture-process proof, capture-origin verification, prior exclusion, census,
freeze, candidate manifest, and Codex readiness false.

A separate fork-none reviewer replayed both complete local bundles, inner and
outer asset locks, structures, request IDs, and identity projections. Its
1,579-byte response SHA-256 is
`b71f659284b477b85d3cb7fd19912774b8f72b953f9b543966ced1f795e0a740`;
the orchestrator-recorded provenance SHA-256 is
`14ac08a41e2fbcc4bc0cc8a33409d6a029951fd6b61c8f50457a0395394b228e`.
That receipt accepts only local observation replay and records both
cryptographic receipt and independence verification as false.

The review identified `/private/tmp`-only evidence as a promotion blocker.
The complete bundles are now stored in a commit-ready portable closure under
`fixtures/codex-coding-effect/c6-source-pool/provenance/source-v3-simple/prior-repository-identity/portable-evidence-v1/`.
Capture A is 513,569 bytes with SHA-256
`5fe5a4c2cf6769095a0f3e05d4316dde22019f05adbb62cce6df6473de5c7120`;
capture B is 514,548 bytes with SHA-256
`4a04936a325108ab189f68f6d5354d7ccab1be5aad6a010ffc0add85cb9e5b10`;
the 9,028-byte manifest SHA-256 is
`3add09d058514b37c71aaf5204cbcbae52a0223f0c99820e872ad19878631dec`.
A fresh process, given only that portable root plus the exact frozen
plan/protocol/source inputs, unpacked and replayed both bundles without either
original temporary root or a separate receipt file. Reads, decompression, and
entry count are bounded; paths, duplicate aliases, links, and special entries
are rejected; stable reads bind pre-open, opened-fd, post-read, and terminal
path identity and reject hard links. Independent repair review found no
remaining P0/P1. Strict portable/promotion reads reject hard links while the
legacy atomic hard-link publication protocol remains available to existing
materializers. The asset-lock plus portable slice passes 10/10 tests with
33 assertions and typecheck.

The historical source-v3 promotion gate is implemented and passes 11/11 focused tests
with 45 assertions in isolated Git repositories. It requires a one-parent
freeze commit, a strict descendant containing the exact pre-registered census
authorization entrypoint, and an explicit promotion base that equals HEAD at
generation. Durable verification permits only a later HEAD descended from that
base and rechecks the complete F/I/base/HEAD/runtime closure. The gate uses
raw Git commit headers, disables replace objects and inherited `GIT_*`
overrides, rejects legacy grafts, proves freeze-time path absence with
`ls-tree` rather than interpreting object-read errors as absence, and binds
the promotion CLI, verifier sources, `package.json`, and `bun.lock`. The
canonical activation module is dynamically imported in the positive test and
must verify the exact promotion receipt before returning census-entry
authority. This historically authorized entry into formal source-row census
only; it was not a census result, full census runner, candidate allocation, or
Codex-run proof.

The stable pre-freeze checkpoint also rematerializes the controlled-mutation
receipt in its exact pinned Linux/amd64 image after synchronizing the frozen
asset-reader closure. The default canonical suite passes 5938 tests with 17
skips, 0 failures, 50726 assertions, and 13 snapshots across 678 files.
This is regression evidence for the checkpoint, not a completed readiness
step, candidate freeze, Codex execution, or uplift result.

`main` now contains the qualifying one-parent freeze
`ba4cee1e668adff0354b23dd743ae44e23e42af9` and strict descendant census
activation/promotion base
`cc42f0bbd673b6595a6c82b3c5cb995a8efbe826`. The materialized 12,652-byte
receipt is
`fixtures/codex-coding-effect/c6-source-pool/provenance/source-v3-simple/promotion/promotion-receipt-v1.json`
at SHA-256
`a0892b9c87cce89b23604a43b02d06ad1344fe010afd4894a5f6c387c7d43e3b`.
Exact rebuild verification closes prior node-ID exclusion, freezes
source-v3-simple, and proves that historical promotion boundary. It deliberately
keeps external authenticity, independent capture-process proof, candidate
selection, candidate-manifest freeze, and Codex readiness false. It does not
override the later terminal observation disposition or grant current authority
to resume or promote v3.

The earlier Rekor/Quicknet/Ethereum provider analysis remains useful only as
the explanation for why source-v2 never authorized capture. It showed that a
locally chosen salt, best-effort Rekor lookup, hidden timestamp, or freshly
generated nonce-zero account cannot prove a unique first draw. That
anti-grinding design is now a historical, superseded blocked design, not a
current T001 dependency. No provider receipt, BLS verifier, Ethereum
transaction, or user-supplied key was required by `source-v3-simple`, because
complete census meant processing order could not change cohort membership.

Source-v1, source-v2, the prior-178 plan, and source-v3-simple remain
reproducible, non-authorizing historical artifacts. Their exact hashes and
fail-closed behavior are not rewritten as current evidence, and they receive no
compatibility authorization path. The v3 RF5 observation ran on Apple arm64
with Bun 1.3.11, encountered the affected runtime liveness incident, and is
terminally `abandoned-infeasible-observation` and `not-promotable`. Commit
`16bb256a` now rejects arm64 Bun below 1.3.12 and exact-matches observed Bun and
Node versions to the frozen runtime; that guard does not repair, resume, or
promote the stopped observation.

The observation contains a complete repository-phase prefix of 4,497 logical
requests, 191,612 repository rows, and 191,604 rows after the historical
prior-repository exclusions. The successor evaluation ID
`goodmemory-c6-codex-coding-effect-source-v4-bounded-v1` is now implemented as
a separate bounded protocol, not a continuation of v3. Its formal loader pins
the exact v3 frame/input/runtime identities, all 9,277 committed attempts, the
4,497-completion prefix root, normalized rows/decisions/leaf closures, and all
3,578 distinct repositories appearing in every committed v3 PR request,
including retry and in-flight evidence. The selector consumes only
`repositoryNodeId` and `sourceSplit`, ranks with the pre-pilot runtime
authorization SHA-256, and selects 2,048 repositories per language without
replacement or top-up.

One canonical external selection snapshot has been materialized and then
re-materialized under the pinned Bun 1.3.12 (`700fc117...`) / Node 24.3.0 /
Apple arm64 runtime. The two published directories are byte-identical. It
contains 12 exact assets plus `asset-lock.json`, totals 269,523,056 bytes, and
has asset-lock SHA-256
`73ccd3d157a1ea3e211c72be80f88c4891d08909226e95cf1011e65e37c3c3a9`.
The prefix, pilot-exclusion, selection, and selected-row SHA-256 values are
`fe6791ea...51e6`, `20a80aed...3084`, `733bd7e3...4305`, and
`a7e858c8...efaf`. Parsing does not grant authority: the loader rebuilds and
verifies each branded receipt, checks an exact 12-file set, reloads the asset
lock at the end, and rejects request substitution, frozen-manifest drift, or
extra hidden files even after the attacker rebuilds the asset lock. The
materializer takes the same writer lock used by the historical v3 runner before
its first source scan, holds it through temporary-asset writing, performs a
second complete exact v3 source replay immediately before publication, and
releases it only after atomic rename and verified reload. The
historical-request scanner validates each logical completion through the
original v3 evidence verifier, including attempt, response, retry-decision,
projected-result, and terminal `stop-success` identity, rather than accepting a
schema-valid self-consistent completion. Those response values are read only
to validate evidence integrity and are not selector inputs. A verified snapshot
is revalidated against its receipt chain, manifest, asset lock, and byte count
on every capture-plan build, so post-verification same-language cohort mutation
fails closed. The loader retains the first asset identity in a private
`WeakMap` and deeply freezes its returned ordinary object/array graph, closing
self-consistent identity rewrites and getter-based verification/use TOCTOU.
The transport collector is module-private; there is no exported live transport
entrypoint. The focused v4/Bun unit slice passes 29/29 with 135 assertions; the
pinned Bun 1.3.12 real snapshot gate passes 5/5 with 21 assertions. The
separate liveness protocol exact-binds the Bun executable and copied child
source hashes, replaces stdout claims with per-seed challenge-bound canonical
records capped at 16 KiB, preserves partial operation counts in failed results,
and bounds post-kill reap. Its real pinned gate passes 1/1 with 18 assertions
over three seeds, 100,000 work items and 700,000 filesystem promise operations
per seed.

This is a materialized selection input, not a reviewed/frozen source capture.
Its manifest deliberately keeps `independentReviewAccepted: false`,
`liveCaptureAuthorized: false`, `candidateManifestFrozen: false`, and
`codexRunReady: false`. A separately provenance-bound independent review and
freeze must authorize the one live capture. The historical v3 activation
authority remains unusable.

None of those rows is a three-stage memory episode by itself. Before an
upstream row can enter C6, intake must pin dataset revision/path/file hash/row
ID, original issue or PR response, repository commit/tree, evaluator-only
patch/tests, historical license bytes, and a Linux replay showing base failure,
gold success, and protection-test success. A separate relationship record must
then prove original-request chronology, merge/base ancestry, and a concrete
prior-task dependency. A preregistered merge-order-regression class would be a
separate policy, not a post-hoc substitute for request chronology. File
overlap, nearby PR numbers, or keyword similarity alone are insufficient.
T001 may seal this dataset intake/selection closure, but final
`candidateManifestFrozen` remains false until the later package, repository,
Linux profile, and equal-budget prerequisites in the readiness ladder also
pass.

Relationship-closure checkpoint (2026-07-25):
`c6-task-relationship-receipt.ts` now makes every adjacent task edge
executable instead of accepting a reviewer string. For a three-stage episode,
the source-record v5 contract requires exactly two ordered relationship
receipts. Each receipt binds the prior and later immutable issue projections,
the prior merged PR projection, and a raw Git commit-object path from the
later stage snapshot to the prior merge commit. The verifier recomputes every
SHA-1 or SHA-256 Git object ID from `commit <byte-length>\0<raw-body>`,
requires one object format, walks every declared parent hop, enforces
`prior.created_at < completion.merged_at < later.created_at`, requires the
issue projections to be unedited (`created_at == updated_at`), and rejects
non-canonical GitHub locators, mixed issue/PR URL kinds, path traversal,
detached requests, duplicate request identities, missing/reordered edges,
forged bytes, and sibling histories.

The independent task-origin protocol is now v5. Its request binds
`rawGoldAccess: false` and `runOutcomeAccess: false`; its response must contain
exactly one accepted semantic decision for each expected edge, including both
“prior completion implements prior request” and “later request depends on the
prior task.” Missing, duplicate, extra, reordered, or receipt-hash-drifted
decisions fail closed. The old per-episode `reviewer` label has been deleted:
reviewer identity and `reviewedAt` now come only from the asset-bound
request/input/dispatch/response provenance, remain explicitly
`cryptographicReceipt: false`, and must be separate from every episode author.
Relationship evidence is included in `relationshipClosureSha256`, the episode
lineage closure, and candidate plan schema v7, so changing an edge changes the
candidate input. The standalone candidate builder recomputes the reviewed
episode-ID closure, exact edge/receipt identity closure, and decision count;
its status is deliberately only
`candidate-closure-accepted-readiness-artifact-verification-required`, because
artifact bytes are verified by readiness rather than by that builder.

The 391-episode readiness fixture materializes 782 synthetic edge receipts only
to exercise this protocol; it is not a candidate dataset or external-source
receipt. The focused relationship/review/lineage/candidate/source-v3 unit
slice passes 43/43 with 1,751 assertions, the complete readiness mutation
suite passes 38/38 with 90 assertions, the source-v3 exact gate passes 1/1
with 11 assertions, and typecheck passes. A fully rehashed sibling-commit
mutation and a fully rehashed review-decision receipt-hash mutation are
rejected by the end-to-end readiness path.

This checkpoint does not authenticate GitHub or Git object provenance.
Self-hashes prove internal byte closure, not that the bytes came from the
claimed repository. No completed source-v3 HTTP/census capture exists; the
planned v4 capture, repository ref/object reachability, actual gold-blind
per-edge review, evaluator replay, and final allocation remain open. Therefore
accepted episodes remain zero, `candidateManifestFrozen: false`, and
`codexRunReady: false`.

#### C6-T002: add flat-summary arm

- fixed summary model/prompt;
- equal maximum injected token budget;
- equivalent ordered hook-event placement and per-event token caps;
- history source hash equality;
- cost recorded.

Structural-corpus checkpoint (2026-07-25): `c6-flat-summary.ts` now separates
one receipt per distinct non-empty generation input from the per-stage,
per-seed bindings that reuse that generated output. Its exact-set verifier
rejects missing, extra, duplicate, wrong-history, wrong-generation,
cross-seed-output-drift, and any no-history provider receipt or binding.
`c6-readiness.ts` can report the structurally verified generation and stage
binding counts, but deliberately keeps
`authenticatedGenerationReceipts: 0`,
`providerAuthenticityVerified: false`, `candidateManifestFrozen: false`, and
`codexRunReady: false`. The focused unit/readiness replay passes 74/74 and
typecheck passes. This is only the corpus protocol: no canonical summary
corpus has been generated, no raw provider request/response provenance has
been authenticated, and no installed-host event-placement parity has been
shown.

Injected-transport checkpoint (2026-07-25):
`c6-flat-summary-generation-capture.ts` now requires the exact frozen
GurkiAI endpoint, request model/prompt/history/protocol, and code-unit request
order. HTTP 200 is only a received state: invalid JSON, response shape, usage,
observed model, or shared-budget output remains a rejected attempt with its
raw bytes, hashes, retry sequence, and canonical manifest retained. The raw
`$.model` must exist and equal the frozen `gpt-5.6-terra` model, and both the
normalization index and artifact bind that observed value. No-history stages
make zero provider calls, token-reflecting responses are rejected without
retaining the token, and all resulting artifacts still hard-code
`providerAuthenticityVerified: false` and `codexRunReady: false`. Independent
review found no P0-P3 in this structural boundary; its focused replay passed
50/50 with 1848 assertions, and the wider local C6 combination passed 105/105
with 2391 assertions plus typecheck. No live request was made and no corpus
was materialized. Provider/TLS identity, pricing, leakage, asset-lock,
external-witness, canonical-corpus, stage-artifact, and installed-host
placement evidence are still absent, so this checkpoint does not complete
C6-T002.

#### C6-T003: package-isolated reproducibility

- build package/tarball once;
- hash it;
- install only that artifact in every arm;
- install an exact, separately closed Codex package/runtime rather than using an
  ambient host executable;
- run on a pinned Linux x86_64 environment for the final claim;
- keep Mac native runs as separate diagnostic evidence.

The GoodMemory package-closure materialization, Codex 0.145.0 package-install
materialization, and the local two-run offline source build now exist. C6-T003
is still open because none is a cryptographically authenticated execution
witness or external independent attestation, and the exact packaged-Linux
installed-host configuration and treatment-injection profile have not been
captured.

Structural aggregation checkpoint (2026-07-25):
`c6-installed-host-evidence.ts` can hash- and relation-check the retained
source-v2, package-rebuild, and Codex-install receipts plus declared host and
ordered hook-event metadata. Its public verifier has no caller-supplied
current-runner override and currently fails closed: the live source-runner
closure is
`39cc7f153b2e532d9d4a2179d20d2dfc8704dee9fb05c3581ddc44c52e9d62bf`,
while the retained v2 receipt binds
`e18b9b7ce6c7929deb20c5aa3ca394d3a779f23bfb69055b21907f2bd3d2f84f`.
The separate structural helper always reports
`currentSourceRunnerBound: false`; it also reports
`finalCompositionBytesBound: false`,
`flatSummaryPlacementParityProven: false`, and every execution,
authentication, witness, installed-host-proof, and run-readiness field as
false. Focused replay passes 5/5, and independent rereview accepted the helper
with those boundaries and no P0-P3. This is a checksum/relationship helper,
not T003 evidence or readiness integration.

Local request-placement canary checkpoint (2026-07-25):
`c6-installed-host-placement-linux.ts` now installs the frozen GoodMemory and
Codex 0.145.0 package closures inside two fresh pinned Linux x64,
network-none containers and observes eight real Codex Responses requests
through an in-container loopback provider. It verifies the packaged
recommended GoodMemory profile, exact SessionStart/UserPromptSubmit placement,
native Stop behavior, a mirrored-hook transport control, a hooks-disabled
control, and a fourth frozen flat-summary hook control. The flat control reads
one exact no-wrapper output from the read-only runner mount, injects the same
45-token bytes at both native events, and binds separate receipts to the
1024-token SessionStart cap and 512-token UserPromptSubmit cap with the same
frozen token counter. This proves only local hook projection and per-event cap
binding; the output is not provider-generated corpus material.
Transport-only normalization, two distinct fresh roots, and byte-stable
semantic projection are also verified.
Container deletion authority is separately bound from execution acceptance;
all create attempts must reach a four-label zero-candidate proof before host
roots are deleted, primary and cleanup failures are both retained, and
terminal source/input closure checks precede exclusive publication. Persisted
artifacts must also pass a current-runner projection that binds the frozen
package/image/Codex identities, exact 512/1024 profile, flat control, and
transport preimage rather than trusting a self-declared current runner hash.
The earlier v7 and v8 files are historical diagnostics and fail the current
wrapper after this hardening.

The external-only v9 diagnostic is 488782 bytes at SHA-256
`3ba8c0d57e5f5a39ef723939a9063e4aed6c7c2fbd68e70ea056c0a60abd3b0a`.
Its frozen and two observed runner hashes all equal the current runner
`2cf3e767852cc3d4d056e7b152c6b2028501e025833c64145f9a8a24959e2dc1`.
Both verifiers pass, with 2 capture envelopes / 8 requests, and no retained
containers or temporary roots. An independent read-only consistency review
found no P0/P1 in the current projection; its suggested identity-regression
gaps were closed with synchronized package, image, Codex-tarball/version, and
GoodMemory-version mutations. The focused runner, verifier, and CLI replay
passes 18/18 with 130 assertions and typecheck passes. The prior full canonical
suite was interrupted without a final verdict and is not counted as green.

This v9 file lives only under `/private/tmp`; it is not tracked, asset-locked,
cryptographically authenticated, or externally attested. Its flat-summary arm
uses a frozen local canary output, not the final provider-generated 391-item
corpus, and hooks-disabled is not yet the final experimental no-memory arm. It
therefore keeps
`c6T003Complete`, `codexRunReady`, `finalInstalledHostProfileProven`,
`flatSummaryPlacementParityProven`, `executionAuthenticated`, and every other
promotion boundary false. `flatSummaryHookProjectionStructurallyBound: true`
is only a local structural canary result, not C6-T002/C6-T003 completion or
coding-effect evidence.

Current readiness remains pre-execution: there is no frozen real 391-episode
dataset, authenticated summary corpus, 10,557-call execution, frozen
statistical report, or C7 gate. The tested statistical primitive does not
change that boundary.

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

`c6-repository-statistics.ts` is a tested statistical primitive for the
repository-then-episode bootstrap, equal-repository sensitivity,
leave-one-repository-out analysis, and claim predicates. It is not yet wired
to a complete attempt loader, frozen C6 report, independent replay, C7 gate
artifact, or claim-boundary publication path.

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

- positions-two-and-later resolve@1 delta versus no-memory is at least +10.0
  percentage points;
- repository-then-episode hierarchical 95% interval lower bounds are greater
  than 0 for both the episode-weighted and equal-repository statistics;
- every leave-one-repository-out episode-weighted delta is greater than 0;
- rescue count exceeds regression count;
- episode completion delta is non-negative;
- pass-to-pass regression rate is not worse than baseline by more than 2.0
  percentage points;
- stale-update/correction safety pass rate is at least 95%;
- irrelevant/no-history negative-control resolve rate is non-inferior within
  2.0 percentage points;
- GoodMemory hook/writeback success is 100% for finalized GoodMemory stages;
- all cost and latency metrics are present.

The pilot caused this one pre-freeze revision from +5.0 to +10.0 points so the
threshold matches the planning effect size. The pilot's 113-episode all-stage
calculation is retained as provenance, while the current headline-position
budget uses 391 only as its `minimumEpisodeFloor`. Candidate freeze and full
execution additionally require an outcome-blind, independently reviewed
repository-family allocation and power/precision artifact. After the
claim-candidate manifest is frozen,
thresholds cannot move in response to results.

### 17.4 Strong-control gate

Before claiming that GoodMemory is better than ordinary context carry-forward:

- both arms must respect the same maximum injected token budget;
- summary generation cost must be included;
- an accuracy-superiority claim requires at least +3.0 percentage points versus
  flat-summary, both hierarchical 95% interval lower bounds above 0, and every
  leave-one-repository-out delta above 0;
- a cost-efficiency claim may instead use a predeclared 2.0-point
  non-inferiority margin for both hierarchical intervals and every LORO delta,
  but must show at least 20% lower total cost per resolved stage and cannot be
  worded as accuracy superiority.

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
> percentage points; repository-hierarchical episode-weighted 95% CI
> <episode-interval>; equal-repository 95% CI <repository-interval>; minimum
> leave-one-repository-out delta <loro-minimum>) across <episode-count>
> episodes, <repository-family-count> repository families, and <stage-count>
> stages, with zero unresolved infrastructure failures.

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
