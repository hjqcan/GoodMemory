# GoodMemory Benchmark Optimization — Research Synthesis and Plan

Date: 2026-07-20, updated through 2026-07-31. Status: research, implementation,
and explicitly labeled benchmark experiments (see the implementation log).
Historical claims whose raw artifacts are absent are not treated as
reproducible current evidence. Sources: full repo exploration
(recall/write/eval/task-board), the Claude Code source snapshot under
`third-party/claude-code-main`, and external web/paper research (benchmarks
SOTA + memory-system architectures, cited inline). All external effect sizes
are as-reported by their authors; vendor-only numbers are marked [vendor].

Goal: raise LongMemEval / LoCoMo / BEAM / MemoryAgentBench / ImplicitMemBench
scores through **generalized mechanisms only**, inside the existing discipline:
ADR-005 admission criteria, the ≥3pt target-slice / ≤1pt protection rule, no
benchmark literals in `src/recall`, dual strict+judged reporting, and the
Phase 74 promotion gate. Every recommendation below names its measurement plan
and its overfitting guardrail.

---

## 1. Where score is lost today (repo's own numbers)

| Benchmark | Current | Weakest axes | Loss taxonomy |
|---|---|---|---|
| LoCoMo (v0.6.0 claim) | official 0.8708 / strict-F1 0.6299 | open_domain 0.6146; historical rules-only category floor: multi_hop 0.305, open_domain 0.229 | Phase 65 full-root: 1003 wrong = **647 missing-evidence + 356 noisy-full-recall + 0 clean-full-recall**; named bottleneck = candidate-pool **admission**, then noise |
| LongMemEval (paused) | no valid current score; 0.720/0.888 and 0.762/0.924 withdrawn | historical contaminated diagnostics suggested temporal, preference, and multi-session gaps | The former 119-error taxonomy is hypothesis input only because its source path was answer-aware |
| BEAM 100K (v0.6.0 claim) | unified 0.7651 / strict 0.620 / recall 0.8276 | event_ordering 0.371 (partly label artifact), knowledge_update 0.594, multi_session_reasoning 0.647 | Binary-track answer gap: 122 wrong = **58 full-recall-clean + 37 full-recall-noisy + 15 missing-evidence + 7 abstention**; top families conflict_update 29, instruction_following 27 (KILL), temporal_order 23, aggregate_count 15 |
| MemoryAgentBench (claim) | CR 0.959, TTL 0.933 | AR/LRU excluded (no measurable memory lift); TTL was semantic/label-transfer-limited before hybrid | CR is answer-time conflict resolution over deliberately-retained stale facts |
| ImplicitMemBench (internal) | 0.691 | priming 0.5435 (blocking 0.765) | Priming shows material judge variance on identical stored answers |

Consolidated: the two dominant, cross-benchmark loss modes are
(A) **answer-side synthesis over retrieved-but-noisy or retrieved-but-unordered
evidence** (BEAM 58+37, LongMemEval 64/119, LoCoMo 356 noisy) and
(B) **retrieval admission for paraphrase / bridge / temporal-constrained
queries** (LoCoMo 647 missing, LongMemEval temporal recall 0.767, BEAM msr
candidate-pool gap). Update/conflict handling sits inside (A) but has its own
structural cause on the write side (§2.2).

## 2. Verified structural findings in the current pipeline

### 2.1 Read side — advertised mechanisms that are OFF in production (verified)

1. **Dynamic fusion budget is disabled.** `selectDynamicFusionBudget`'s
   relative-strength floor (default 0.35, `src/recall/generalizedFusion.ts:97`)
   is overridden to `0` on the live path (`src/recall/engine.ts:1311`), so the
   "dynamic candidate budget" degenerates to a fixed top-`maxCandidates` cut.
   Noise control that was designed is not running.
2. **Temporal visibility is enforced for the lexical channel only.**
   (Corrected 2026-07-20 during implementation: an earlier draft said document
   visibility was disabled wholesale — wrong.) `buildLexicalChannel` and
   `buildVisibleSourceKeys` always filter searched documents by
   `effectiveFrom`/`effectiveUntil` when a reference time is set
   (`src/recall/generalizedFusion.ts:159-193`). `documentSetComplete: false`
   (`engine.ts:1261`) only disables visibility filtering for the **dense and
   entity** channels — and correctly so: the visibility set is built from a
   bounded FTS search, so a valid dense candidate's documents may simply not
   match the query text; gating on that incomplete set would wrongly drop
   dense evidence. The real gap: dense/entity candidates get **no**
   per-candidate validity check at all. The honest fix is record-level
   validity on the candidates themselves (folded into R3, where
   `observedAt`/validity fields become reliably populated), not flipping the
   completeness flag.
3. **Non-fact fusion output is capped at tiny fixed quotas.** (Corrected
   2026-07-20 during implementation: an earlier draft said non-facts were
   discarded outright — wrong.) Fusion ranks facts + references + episodes +
   session_archives (`src/recall/engine.ts:1239-1245`); the fact union filters
   to facts (`engine.ts:1361-1366`), while non-facts are admitted through
   `admitGeneralizedRecords` into their own lanes with fixed caps of
   **1 reference / 2 episodes / 1 session archive**
   (`engine.ts:1535-1606`), regardless of what the plan needs. A
   multi-session question cannot get more than 2 episodes + 1 archive of
   fused dialogue context however strong the evidence — the R1c work is
   making these quotas plan-responsive, not adding a missing lane.
4. **English tokenizer drops tokens shorter than 4 chars**
   (`src/language/english.ts:1466-1472`): acronyms, IDs, and short entity
   names ("AI", "RL", "SF", model numbers) vanish from every lexical channel
   (BM25, entity alias matching, overlap scoring).
5. **No per-query time anchor.** `referenceTime` is a config-level clock
   (`src/recall/engine.ts:635`); `RecallInput` has no reference-time field
   (`engine.ts:116-127`). A per-question anchor is only possible by
   hand-crafting `recallPlan.temporalConstraints[].referenceTime`
   (`engine.ts:1218-1220`), and the deterministic plan builder can only parse
   ISO dates and bare years from query text (`src/recall/recallPlan.ts:89-111`)
   — "last May", "two weeks before the wedding", month names, and
   question-date anchoring are all invisible.

Also relevant at the original audit baseline: unweighted RRF across heterogeneous
channels (`generalizedFusion.ts:834`, all channels `1/(60+rank)`); the reranker
then touched only the top-20 facts. Phase 74 replaced that path with a bounded
32-candidate global durable pool across facts, references, episodes, and session
archives, followed by one global 12-evidence selection. Multi-hop bridges by literal
concatenation of capitalized tokens (`src/recall/iterativeRecall.ts:50-100,211`);
plan budgets are forced constant (`preRankLimit 32` / `selectedLimit 12`,
`recallPlan.ts:10-12`) even when the LLM planner runs; general fact selection
caps at 6 (`src/recall/generalizedSelection.ts:27`).

### 2.2 Write side

1. **Two explicit facts never supersede each other.** Fact supersession fires
   only inferred→explicit with ≥0.4 token overlap
   (`src/remember/handlers.ts:497-507`); dedup keys on exact normalized content
   equality. "Manager is Alice" (session 2) and "manager is Bob" (session 9)
   both stay active and each projects a *current* claim (claim status is
   per-`sourceMemoryId`, `src/recall/projections/claims.ts:211-236`). All
   conflict resolution defers to read time. This is the structural cause behind
   BEAM conflict_update (29 wrong) / knowledge_update 0.594 and the CR-style
   failures — even though the extractor already emits `subject` +
   `metadata.claim.predicateKey` that could key supersession structurally.
2. **The bi-temporal layer exists only on the LLM path.** `queueClaimProjection`
   returns early when `metadata.claim` is absent (`handlers.ts:116-119`); the
   deterministic extractor rarely sets it; the fallback unstructured claim
   stamps `observedAt` from transaction time, losing session date
   (`claims.ts:388-396`). In `auto` mode many turns get no time-anchored
   structured representation at all.
3. **`FactMemory` has no `observedAt`/`polarity`/`predicateKey`** — event time
   survives only on the claim projection and on the `[date]` prefix the
   benchmark adapter happens to prepend to content
   (`src/eval/phase74Datasets.ts:243,351`, `src/remember/builders.ts:212-214`).
   Any channel ranking over fact records/embeddings has no time anchor and no
   negation signal.
4. **Per-session extraction batching, no cross-session context.** One
   `remember()` per session; only `knownUserName` crosses sessions
   (`src/remember/engine.ts:563-566`). Cross-session coreference and
   out-of-session relative dates stay unresolved.

### 2.3 Answer side

Answer generation is eval-layer LLM prompting over the evidence pack
(`src/eval/answer-generator.ts:35-43`, `src/eval/protocol-reader/evidencePack.ts`);
abstention is prompt-side; `src/answer/currentValueResolution.ts` implements
deterministic latest-wins with a conservative denial-contradiction flag — the
right primitive, currently starved of structured, correctly-timestamped input
by §2.2.

## 3. External evidence base (compressed)

### 3.1 Honest score landscape (mid-2026)

- **LongMemEval-S**: full-context GPT-4o 60.2, oracle-retrieval 82.4 (paper);
  Zep 71.2 (paper); Mastra Observational Memory 94.87 [vendor, methodology
  published]; Mem0 94.4 [vendor, harness undisclosed]; MemMachine 93.0 (paper);
  Hindsight 91.4 (paper). GoodMemory currently has no comparable LongMemEval
  score: its former 0.720/0.888 and 0.762/0.924 artifacts are contaminated by
  answer annotations or gold-bearing session IDs.
- **LoCoMo**: ~6.4% label errors → ceiling ≈93.6; default judge accepts ~63%
  of wrong-but-topical answers (Penfield audit); Letta grep-agent null
  hypothesis 74.0; honest cluster 75–92; several >93 claims are
  self-disqualifying. GoodMemory 0.8708 official / 0.6299 strict is genuinely
  competitive and better-evidenced than most.
- **BEAM**: paper baselines ≈0.31–0.36 at 100K (nugget judge; event_ordering
  scored Kendall-tau upstream); Hindsight BEAM-1M 73.9 [vendor+paper]; Mem0
  64.1@1M [vendor]. GoodMemory's 0.7651@100K uses the MemPalace-#125-style
  all-items unified judge — any external comparison must spell this out
  (already disclosed in `benchmark-claims/beam.json`).
- **MemoryAgentBench**: paper-era CR ≤60% SH / ≤7% MH for all 22 systems;
  published deterministic-recipe SOTA (arXiv 2606.01435) 94.8 SH / 51.5 MH.
  GoodMemory CR 0.959 exceeds SH SOTA — worth disclosing the SH/MH composition
  of the 73-question set precisely when citing externally.
- **ImplicitMemBench**: best published model 65.3 overall; priming clusters
  42–52 for everyone; the paper finds external memory frameworks do NOT
  reliably help. GoodMemory 0.691 (priming 0.5435) already exceeds published
  numbers — differentiating if the protocol matches exactly.

### 3.2 Mechanisms with published effect sizes (most relevant subset)

| Mechanism | Evidence | Hits |
|---|---|---|
| Time-aware query expansion (parse time range from question → constrain/boost retrieval) | +7–11% temporal recall (LongMemEval paper ablation, arXiv 2410.10813) | LME temporal, LoCoMo temporal, BEAM temporal_order |
| Structured JSON evidence + Chain-of-Note reading | up to +10pp reading accuracy (2410.10813); CoN +7.9 EM under noise, +10.5 rejection (arXiv 2311.09210) | answer-side buckets everywhere, abstention |
| Deterministic freshness (versioned states, `max(serial)` in code; never LLM date comparison) | CR 94.8 SH / 51.5 MH (arXiv 2606.01435). Correction 2026-07-23 (user-reported): an earlier draft stated the paper's deterministic-vs-LLM timestamp comparison backwards — the LLM-judgment regime scored 64.4 vs 57.8 for the deterministic one, and both numbers come from whole-pipeline configurations, not an isolated freshness-resolver ablation. The 94.8/51.5 recipe result stands; the head-to-head no longer supports "deterministic beats LLM" here | BEAM conflict/knowledge-update, MAB CR, LME knowledge-update |
| Bi-temporal soft invalidation (close `validUntil` of contradicted claim at write; never delete) | Zep/Graphiti (arXiv 2501.13956, DMR 94.8, LME +18.5% vs full-context); Mem0g converged on same | update/temporal families |
| Segment/episode granularity (topic-coherent segments as retrieval units) | SeCom, ICLR 2025 (arXiv 2502.05589): segment-level beats turn- and session-level across retrievers; Nemori 0.83 LoCoMo with episodes+BM25+vectors | multi-session, LoCoMo open_domain/multi_hop |
| Turn-level scoring with session-context injection | Emergence/MemMachine ablations (contextualized retrieval +, retrieval-depth +4.2%) | LME multi-session, LoCoMo multi_hop |
| Write-time question expansion (doc2query for memories) | >15% MAP/MRR for BM25 at zero query-time cost (docTTTTTquery); "fact-augmented key expansion" +4% recall/+5% QA (2410.10813) | paraphrase gap = LoCoMo admission bottleneck; embedding-free |
| Personalized PageRank over entity/passage graph | HippoRAG2 +7 F1 associative over best dense retriever; PPR ≈ IRCoT at 10–30× lower cost (arXiv 2502.14802, 2405.14831) | multi_hop, open_domain |
| Bounded iterative retrieval (self-ask/IRCoT, 2 rounds, gated) | IRCoT +15pt QA multi-hop (ACL 2023); deterministic per-hop variant +20 over prior best on versioned MH (2606.01435) | multi_hop |
| Profile slots with overwrite semantics for slot-like facts | Memobase (LoCoMo temporal 0.8505 era); LangMem profile-vs-collection | knowledge-update, abstention ("empty slot" = clean unknown) |
| Synthesized tier: reflections/observations over raw+atomic | Generative-agents reflection; Hindsight "observations" credited for BEAM SOTA; TriMem: atomic-only "fails deep reasoning over scattered facts" (2605.19952); RAPTOR +20% holistic QA | summarization, open_domain, BEAM msr |
| Sleep-time consolidation worker | Letta sleep-time: −5× test-time compute, +13–18% (2504.13171); LightMem +10.9% at −117× tokens (2510.18866); RMM +10% (2503.08026) | enables the above without query-time cost |
| Listwise rerank / memory-tuned small cross-encoder | pointwise LLM = worst quadrant (slow+uncalibrated); MemReranker-0.6B ≈ GPT-4o-mini at 10–20% latency (2605.06132) | full-recall-noisy buckets |
| Novelty gate on writes (embedding-density ADD/NOOP/MERGE) | SAGE: −3.4× write cost, ~17% LLM calls skipped, quality preserved (2605.30711) | cost; duplicate-driven noise |
| Mutation-time LLM hook (deterministic primitives; LLM only on detected conflict) | best regime 91.7–93.2% vs deterministic-only canonicalization failures (2606.15903) | update families, "forget what I said about X" |

### 3.3 The convergence check

Hindsight (arXiv 2512.12818) — the best-published BEAM system — is
architecturally GoodMemory's read side (BM25 + vector + graph + temporal
channels, RRF, rerank) **plus exactly four things GoodMemory lacks**:
bi-temporal soft invalidation, an episode layer, a synthesized-observations
tier, and background reflection. Independent designs (Mem0 2026 retrieval,
Zep, Nemori, LIGHT) converged on the same hybrid-fusion base. The base is not
the gap; the four pieces are.

Claude Code's memory system (verified in `third-party/claude-code-main/src/memdir/`)
contributes the operational patterns: check-before-save update-in-place,
description-as-relevance-key, staleness contract ("a memory is a claim about a
point in time" + freshness headers + verify-before-acting), append-then-distill
consolidation gated on time+volume, and lossy-in-context/lossless-on-disk.

---

## 4. Recommendations

Ordered by (expected impact ÷ effort), respecting dependencies. Each entry:
what → why → how → measurement → overfitting guardrail.

### R0. Run the Phase 74 gate before building anything new

Phase 74's generalized memory core (bi-temporal claims, 5-channel fusion with
temporal+relation channels, query-only planning, EvidenceLedger) is implemented
and idle — zero live runs. It already contains the skeleton for roughly half of
what follows. Running its E1–E4 matrix (3 independent runs × both families,
paired bootstrap + McNemar, protection suites) establishes the new baseline and
tells you which of R2–R8 are already partially delivered by the new core.
**Everything below should be measured against the Phase 74 arm, not only the
v0.6.0 pipeline, to avoid building duplicate mechanisms.**

### R1. Turn on what's already designed (Tier-0 config/dead-code fixes)

Five verified items from §2.1, each a one-line-to-small change in the
generalized path, no new mechanism, no benchmark knowledge:

- R1a. Stop overriding `minRelativeStrength` to 0 (engine.ts:1311); sweep
  {0.25, 0.35, 0.5} on the frozen Phase 69/72 recall diagnostics. Expected:
  noise reduction at equal recall → attacks LoCoMo 356-noisy and BEAM
  37-noisy buckets *at the retrieval layer*.
- R1b. Wire `documentSetComplete` honestly (engine.ts:1261): pass true when the
  projection store enumerated the full scope (it can know), enabling
  effective-date visibility.
- R1c. Admit episodes/session_archives from fusion output behind a bounded
  quota (e.g., ≤2 non-fact candidates of the top-8) instead of the hard
  facts-only filter (engine.ts:1361-1366); render them in the evidence pack as
  context blocks, not facts. This is the cheapest form of session-level
  retrieval (see R5 for the full version).
- R1d. English tokenizer: lower min token length 4→2 while keeping the stopword
  list (english.ts:1466-1472); re-run BM25-sensitive protection slices —
  IDF handles frequent short tokens, but this must be measured, not assumed.
- R1e. Add optional `referenceTime` to `RecallInput` (or auto-derive a
  `temporalConstraints[].referenceTime` from it), threaded from
  `buildLongMemEvalPrompt`-style question dates. Pure plumbing; unlocks R3.

Measurement: existing frozen recall diagnostics (LoCoMo 1986q, LongMemEval
500, BEAM 400) + the ≥3pt/≤1pt rule per slice. Guardrail: all five are
query-structure-agnostic; none can encode benchmark wording. Risk is
regression, not overfitting — hence protection slices.

### R2. Structured evidence pack + Chain-of-Note reading (answer side)

**Why:** the single largest cross-benchmark bucket is wrong answers with full
or noisy recall (BEAM 58+37 of 122; LongMemEval 64 of 119). External evidence:
+7–10pp from structured JSON evidence + per-item relevance notes, and CoN also
*improves* rejection of unanswerable questions (+10.5) — i.e., it strengthens
rather than loosens the abstention posture the project refuses to trade away.

**How:** extend `src/eval/protocol-reader/evidencePack.ts` (and the Phase 74
generic reader) to render each evidence item as a typed record
`{id, claim, source-span, event-time, validity, channel-provenance}`, and
change the answer prompt to require a brief per-item relevance/uses-note pass
before synthesis, citing item ids. Keep the existing operation framings
(current-value / timeline / count) — they're already the deterministic
skeleton of this.

**Measurement:** frozen answer-replay sets that already exist
(`eval:phase-65-reanswer-report` buckets `wrongFullRecallNoisy`,
BEAM answer-gap buckets full-recall-clean/noisy) — this is precisely what those
replay queues were built for. Target ≥3pt on the wrong-with-recall buckets;
protection: abstention slices (LoCoMo adversarial replay 60-row set, BEAM
abstention 0.975 must not drop), and the strict tracks.

**Guardrail:** prompt content must stay question-type-generic (operation-level
framing only, as today); no expected-answer vocabulary. The KILL verdict on
BEAM instruction_following stands — CoN must not be used to smuggle
world-knowledge answering back in.

### R3. Temporal chain, end-to-end

**Why:** temporal is the weakest recall family post-Phase-69 (LongMemEval
temporal 0.767 vs 0.91 knowledge-update), BEAM temporal_order has 23 wrong
mostly full-recall-clean, and the +7–11% external ablation is the largest
single published lever. The pipeline currently loses event time at three
places (§2.1-2, §2.2-2/3).

**How (four increments, each independently measurable):**
1. Stamp `observedAt` on `FactMemory` itself (from source-message
   `observedAt`, as claims already do in `handlers.ts:120-123`) and index it
   on recall documents — every channel gets a time anchor, without depending
   on the `[date]` content-prefix hack.
2. Ensure every fact gets a time-anchored claim: fix the unstructured-claim
   fallback to use session/`observedAt` time instead of transaction time
   (`claims.ts:388-396`).
3. Upgrade the deterministic temporal query parser (`recallPlan.ts:89-111`)
   from {ISO date, bare year} to a proper deterministic date-expression
   grammar: month names, month+year, quarters/seasons, "last <month>",
   relative offsets resolved against the R1e per-query reference time. This is
   a bounded, well-understood parsing problem (chrono-style), not an LLM call.
4. Make the temporal channel a first-class filter/boost: when the plan carries
   a resolved date range, apply range *boost* to all channels and range
   *filter* only at high confidence (both-endpoints-resolved), so weak parses
   degrade gracefully.

**Measurement:** LongMemEval temporal-reasoning slice (133 q) and BEAM
temporal_order/event_ordering families; protection: knowledge-update +
multi-session (dates as noise), LoCoMo non-temporal categories.

**Guardrail:** the grammar is a general date parser — property-test it against
generated dates, not benchmark transcripts; forbid any benchmark-phrase
fixtures in its tests (architecture-boundary test already scans for these).

### R4. Update/conflict chain: structural supersession + deterministic freshness

**Why:** conflict_update is BEAM's largest repair family (29), knowledge_update
is 0.594, MAB CR is the retained-stale-facts case, and the published SOTA
recipe here matches the project's own ethos: structural, versioned supersession
(arXiv 2606.01435: 94.8 CR-SH). Note (corrected 2026-07-23): that paper's
deterministic-vs-LLM timestamp head-to-head actually favored the LLM regime
(64.4 vs 57.8) and compared whole pipelines, so it is *not* evidence that
deterministic freshness beats LLM date comparison in isolation — the case for
R4.1 rests on the repo's own failure taxonomy (both values staying "current"
per §2.2-1), the Zep/Graphiti convergence, and determinism as a product
principle, and it raises the priority of R4.2's mutation-time LLM hook as the
measured complement. The write side already extracts
`(subject, predicateKey, objectText, polarity, validFrom)` — it just doesn't
use them for supersession (§2.2-1).

**How (in order):**
1. **Structural write-time supersession:** when a new claim arrives with the
   same `(subjectEntityId, predicateKey)` as an active claim and a later
   `observedAt`, close the old claim's `validUntil` (bi-temporal soft
   invalidation, Graphiti-style) and mark the old *fact* `superseded` when the
   claim was its only content. Never delete; history stays queryable for
   "change/history" aggregations.
2. **Ambiguity → mutation-time LLM hook** (only when structural match is
   uncertain: same predicate different object-entity vs. genuinely different
   slot): one bounded LLM call at write time on detected conflicts only
   (2606.15903's best-overall regime), behind the existing assisted-extraction
   provider config so rules-only stays deterministic.
3. **Read-time:** `currentValueResolution` already implements latest-wins;
   feed it claim groups keyed by `(subject, predicateKey)` (not content
   clusters), and have the evidence pack lead with the current value plus an
   explicit "superseded on <date>: <old value>" line — the
   both-sides-plus-clarification pattern Phase 63 already proved live for
   contradictions.
4. **Profile slots:** route slot-like predicates (residence, employer, top
   preference categories) into the existing `UserProfile` overwrite fields so
   "current X" questions hit a single-value surface; empty slot = clean
   unknown signal for abstention.

**Measurement:** BEAM conflict_update + knowledge_update families; MAB CR
(watch: current 0.959 must not regress — it is a protection slice here as much
as a target); LongMemEval knowledge-update (0.91 recall / 0.936 acc). The
LongMemEval "latest-value collapse" scorer artifact (gold marks stale+latest
sessions; latest-only answers score 0.5 recall) means **recall metrics can
legitimately drop while answers improve** — evaluate on answer accuracy, keep
recall as diagnostic only for this family.

**Guardrail:** supersession keys on structural identity from the extractor,
never on content patterns; the LLM hook prompt is generic ("do these two
claims describe the same slot?") with no benchmark vocabulary. 2 new claim
columns + one code path — no per-case rules.

### R5. Session/episode granularity as a real retrieval channel

**Why:** LoCoMo's 647 missing-evidence bucket and LongMemEval multi-session
losses are questions whose evidence is a *dialogue span*, not an atomic claim.
SeCom shows segment-level units dominate turn- and session-level across
retrievers; MemoryAgentBench's core finding is that extraction-only systems
discard needed content; MemMachine/Emergence credit turn-scoring →
session-context injection. GoodMemory already stores episodes and session
archives, already projects them at three granularities, and already ranks them
in fusion — then drops them (§2.1-3). R1c is the minimal unblock; this is the
full version.

**How:** (1) at write time, segment sessions into topic-coherent episodes
(boundary detection can start deterministic — speaker/topic shift + time gap —
with an optional LLM segmenter under the extraction provider); store an
episode summary with temporal anchors + turn-span pointers (Nemori-style,
non-lossy: raw turns stay). (2) Give episodes their own fusion output lane
with a bounded quota, and render selected episodes in the evidence pack as a
quoted dialogue span (source-ordered, timestamped). (3) When a fact candidate
wins, optionally attach its ±k-turn source span (contextualized retrieval) —
bounded by the existing 6000-token render budget.

**Measurement:** LoCoMo multi_hop/open_domain and LongMemEval multi-session
slices; the banked candidate-admission manifests
(`locomo-*-candidate-admission-*`) are purpose-built for this. Protection:
single-hop + noise budget (episode spans are token-expensive; watch the
noisy-full-recall bucket for regression).

**Guardrail:** segmentation is content-agnostic (topic/time-shift signals);
episode summaries are written by the generic extractor prompt. No
benchmark-conversation fixtures in segmentation tests.

### R6. Write-time question expansion (doc2query for memories)

**Why:** the LoCoMo bottleneck is *admission* — the question's phrasing shares
no surface with the stored claim, and neural embeddings tied BM25 (P65-R003)
because ranking can't fix what was never admitted. doc2query attacks admission
directly in the lexical channel at zero query-time cost (>15% MAP/MRR for
BM25; LongMemEval's fact-augmented key expansion +4/+5). Uniquely, it
strengthens the **embedding-free rules-only profile** too — the profile behind
the strict LongMemEval claim.

**How:** during assisted extraction (same call or the sleep-time worker, R9),
generate 2–4 plausible future questions per claim/episode; index them as an
additional field-granularity projection document (`kind: "query_key"`) feeding
the existing BM25 channel — never rendered into context, retrieval keys only
(same pattern as `contextualDescriptor`, which already exists and is
retrieval-only).

**Measurement:** LoCoMo missing-evidence repair queues + open_domain slice;
LongMemEval paraphrase-heavy types (single-session-preference). Protection:
noise metrics (added keys inflate the lexical index; the R1a relative floor is
the natural counterweight).

**Guardrail:** the expansion prompt sees only the claim text — it structurally
cannot know benchmark question phrasing. This is the generalized replacement
for what the 148 narrow gates were hand-doing (mapping anticipated question
forms to evidence), which is why it should clear the ADR-005 bar: general
formulation, structural signal, unbounded case coverage.

### R7. Entity-graph upgrade: PPR + recognition filter

**Why:** multi_hop remains the weakest LoCoMo category; the entity channel is
1-hop adjacency with rarity gating, and lexical bridge concatenation was
measured to *hurt* when first-pass recall is weak. HippoRAG2's PPR is the
strongest-evidence graph mechanism (+7 F1 associative, no query-time LLM), and
GoodMemory already maintains the entity-adjacency projection PPR needs.

**How:** (1) implement personalized PageRank over the entity+claim adjacency
projection (sparse iteration, damping ~0.5, ≤3 iterations, seeded by query
entities and top lexical/dense doc entities) as the entity channel's scoring,
replacing pure 1-hop rarity. (2) Add synonym edges from embedding similarity
when a neural adapter is configured (alias table stays the provider-free
path). (3) Optional "recognition memory" filter: on detected multi-hop plans
only, one small LLM call filters candidate bridge claims for query relevance
before they seed expansion — precision control for the noise this channel adds.

**Measurement:** LoCoMo multi_hop full-root slice (282 q) + the 6-row/10-row
near-miss residual queues (already reproducible); LongMemEval multi-session.
Protection: single_hop, temporal, and the noise budget.

**Guardrail:** graph algorithm over generic projections; no entity literals.
The recognition-filter prompt is generic relevance filtering.

### R8. Bounded iterative retrieval for detected multi-hop (replace lexical bridging)

**Why:** the current `multiHop` (capitalized-token concatenation) is documented
to hurt LoCoMo. IRCoT-style LLM sub-query generation (+15pt multi-hop QA) with
a deterministic per-hop value resolution (2606.01435's Self-Ask variant) is
the evidence-backed version. Gate it on (a) plan says relation/multi-hop, and
(b) first-pass evidence strength below threshold — addressing the measured
failure mode (bad hop-1 → poisoned hop-2).

**How:** under the existing planner provider config: hop-1 recall → if the
plan's target slot is unresolved, generate one focused sub-query from the
hop-1 evidence (LLM, 256 tokens), recall again, merge via the existing
decomposition merge path. Max 2 hops, provider-gated, off in rules-only.

**Measurement/guardrail:** same queues as R7; sub-query prompt is generic;
compare against R7 (PPR may make this redundant — HippoRAG's own finding).

### R9. Sleep-time consolidation: observations, profiles, and expansion precompute

**Why:** LoCoMo open_domain (0.6146 in the current claim; "what kind of person
is X" holistic questions), BEAM summarization/msr, and answer-side synthesis
all benefit from a synthesized tier (generative-agents reflection; Hindsight's
observations; RAPTOR +20% holistic). GoodMemory already has the maintenance
runner + dream job scaffolding (`src/maintenance/runner.ts`) and an
episode-consolidation job — this extends it to facts/entities, off the query
path, mirroring Claude Code's append-then-distill pattern.

**How:** new maintenance jobs (opt-in, provider-gated): (1) entity/topic
observation synthesis — for entities with ≥N claims, write a compact
observation memory citing member claim ids (auditable, forgettable); (2)
profile-slot refresh (R4.4); (3) doc2query precompute (R6) for claims that
arrived via the deterministic path; (4) contradiction sweep upgraded to use
`(subject, predicateKey)` grouping (R4.1's batch form). Observations index
into fusion as regular memories with `derived` provenance.

**Measurement:** LoCoMo open_domain (96 q) and BEAM summarization; protection:
everything (derived memories add index mass) — plus the governance boundary:
derived memories must remain traceable/deletable via existing
provenance+forget paths (a product constraint, not just an eval one).

**Guardrail:** observation prompts are generic synthesis ("summarize what
these claims establish about <entity>, cite ids"); ADR-005's ≥2-case rule
applies to any admission tweak this motivates.

### R10. Reranker upgrades

**Why:** pointwise-LLM is the documented worst cost/quality quadrant, the
audit-baseline reranker saw only top-20 facts, and full-recall-noisy is a top-3
loss bucket. Phase 74 now reranks the bounded global durable pool; the remaining
question is measured cross-benchmark benefit. Note Phase 70 *did* prove the pointwise reranker lifts LoCoMo
target-cohort top-6 recall 0.104→0.771 — so this is an upgrade, not a rescue.

**How:** (1) ~~offer listwise rerank~~ (corrected 2026-07-20: the recommended
preset already sets `providerRerankingStrategy: "listwise"` when a provider
reranker is configured — `src/api/retrievalPreset.ts:140-142`; pointwise
remains only on the non-preset explicit-provider path, which is what the
README describes). Remaining work: verify the LoCoMo claim profile actually
ran listwise, and re-run the frozen LongMemEval rerank gate under listwise;
(2) verify the Phase 74 global fact/reference/episode/archive rerank pool on
held-out cross-benchmark evidence;
(3) optionally evaluate a small memory-tuned cross-encoder (MemReranker-class)
as a local, provider-free reranker — attractive for the zero-egress story.

**Measurement:** the Phase 70 frozen 36-rerank cohort + protection slices;
LongMemEval rerank arm previously *failed* (45/64 vs 47/64) — rerun that exact
frozen gate to see whether listwise flips it; if it doesn't, keep reranking
LoCoMo-profile-only as today.

### R11. Calibrated abstention (tighten, don't loosen)

**Why:** abstention is already strong (BEAM 0.975) and is a product principle.
The remaining wins are *retrieval-aware* abstention quality: LoCoMo adversarial
zero-recall regressions under new levers, and LongMemEval abstention type.
CoN (R2) already improves rejection; add a deterministic signal: channel
agreement + empty-slot (R4.4) + evidence-strength margin exposed to the reader
as a structured "evidence coverage" field, and calibrate the wording threshold
on the existing frozen 60-row adversarial replay plus a *generated* (non-benchmark)
unanswerable probe set.

**Guardrail:** never trade grounded abstention for score (standing KILL rule);
any lever that improves a scored family while dropping abstention slices >1pt
is rejected by the existing rule.

### R12. Evaluation-methodology upgrades (protect the claims while scores move)

1. **Multi-seed variance:** ≥3 seeds/runs with stddev for every promoted
   number (Phase 74's gate already requires this — extend the norm to all
   claim-track updates; ImplicitMemBench judge variance is already documented
   internally).
2. **Judge audit with planted answers:** run each LLM-judge protocol against
   deliberately wrong-but-topical answers (LoCoMo's judge accepts ~63%
   externally); publish the acceptance rate next to the judged track. This
   quantifies the strict-vs-judged gap you already disclose.
3. **Paraphrase probes:** for each family, machine-paraphrase the questions
   (meaning-preserving) and report the delta; a mechanism that wins only on
   original phrasing is fitting phrasing. Cheap to generate; strong
   overfitting detector — this is the external reviewers' top-named failure
   mode and directly tests R6.
4. **Fixed confounds across arms** (MemDelta finding: embedding swap alone
   flips rankings by ±6pp): pin embedding + reader models per comparison;
   already policy in Phase 74's frozen config — make it explicit for any
   cross-arm table.
5. **Cost/latency columns:** report tokens/query beside accuracy on claim
   tables (Phase 74 already builds cost allocation; surfacing it preempts the
   "won by context stuffing" critique and matches 2026 norms).
6. **Held-out hygiene:** both public families are `seenCasesOnly: true` in the
   Phase 74 gate's own terms; the sealed external cohort it requires is the
   right instrument — prioritize building it (a small, never-iterated-on
   conversation set, scored only at promotion time).

## 5. What NOT to do

- **Do not re-try rejected levers as-is:** LoCoMo abstention-retry (failed
  disjoint holdout 5/32), dialog windows, rules-light query expansion, LLM
  turn-captioning, sentence-projection dense arm (protection −3.125pt),
  LongMemEval provider reranking (45/64 vs 47/64), lexical `multiHop` on
  LoCoMo, recovery/pairwise/extractive-reanswer/compression arms. R6/R7/R8 are
  *different mechanisms* aimed at the same buckets; measure them against the
  same frozen gates that rejected their predecessors.
- **Do not chase BEAM event_ordering to parity:** 7/40 gold orders are
  non-chronological (frozen audit); production ordering semantics were
  deliberately not bent to mislabeled cases. 0.72-strict/0.80-unified remain
  stretch diagnostics; treat residual event_ordering losses as partially
  irreducible.
- **Do not reopen BEAM instruction_following:** 17/26 failures are correct
  grounded abstentions on world-knowledge questions — the KILL verdict is the
  product position.
- **Do not present cross-protocol numbers as comparable:** BEAM unified
  (all-items judge) vs upstream Kendall-tau; LongMemEval gpt-5.5/5.4 judges
  outside the pinned zoo; MAB CR SH/MH composition; LoCoMo >93.6% ceiling.
  The declarations already disclose these — keep it that way as scores rise,
  because external scrutiny of memory-benchmark claims in 2026 is intense
  (documented take-downs of MemPalace, EverMemOS, Zep-vs-Mem0).
- **Do not add write-side literals to recover single cases:** ADR-005's
  admission criteria stand; anything that keys on a proper noun or verbatim
  phrase is out, including inside prompts.

## 6. Suggested sequencing

| Stage | Content | Depends on | Primary metrics moved |
|---|---|---|---|
| A | R0 (Phase 74 runs) + R1 (five Tier-0 fixes) | — | recall/noise diagnostics, all families |
| B | R2 (evidence pack + CoN) + R3.1–3.2 (observedAt plumbing) | A | BEAM full-recall buckets, LongMemEval answer-side |
| C | R3.3–3.4 (temporal parser/channel) + R4 (supersession + freshness + slots) | B | LME temporal/KU, BEAM conflict/knowledge_update, MAB CR guard |
| D | R5 (episodes) + R6 (write-time expansion) | A | LoCoMo missing-evidence, LME multi-session |
| E | R7/R8 (graph + iterative) + R9 (consolidation) + R10 (rerank) | D | LoCoMo multi_hop/open_domain, BEAM msr/summarization |
| F | R11 (abstention calibration) + R12 (methodology) | continuous | claim integrity |

Honest expected ranges if A–E land (not commitments): LongMemEval needs a clean
baseline before any numeric target is meaningful; LoCoMo official 0.8708 →
0.89–0.92 (label ceiling ≈0.936); BEAM unified 0.7651 → 0.79–0.82 (stretch
diagnostic band); MAB unchanged-to-slightly-up with CR guarded; ImplicitMemBench
mostly judge-variance-bound. The strict tracks move less than judged tracks by
construction — report both, as today.

## 7. Implementation log (2026-07-20, same-day first pass)

Landed in the working tree with TDD (failing test first), typecheck clean,
targeted suites green. No benchmark run has measured any of it yet; every item
is behavior-preserving by default unless noted. Phase 74 files were not
touched (owned by a parallel workstream).

- **R1a — dynamic fusion budget re-enabled.** Engine honors
  `generalizedFusion.minRelativeStrength` (was hard-coded 0 since the
  2026-07-19 Phase 74 commit; the config field existed but was ignored). New
  experimental public knob `retrieval.generalizedFusionMinRelativeStrength`
  threads through the recommended preset into base and rerank fusion configs.
  Default unchanged (0 = no trimming) until the planned {0.25/0.35/0.5} sweep
  on frozen recall diagnostics. Tests: engine-level trim proof + preset
  passthrough.
- **R1b — closed as investigation.** The `documentSetComplete: false` flag is
  honest (see corrected §2.1-2); invariant documented at the engine call site.
- **R1c — content-lane quotas configurable.** New
  `generalizedFusion.contentLaneRecords` caps for fused
  references/episodes/session-archives (defaults keep 1/2/1). Sweepable by
  diagnostics; a plan-responsive default needs measurement first.
- **R1d — tokenizer short-token fix (two-tier).** English token floor 4→2
  chars with ~45 short function words added to the stopword list; acronyms and
  codes ("RL", "AI", "SF") now reach the lexical index: BM25 additive ranking,
  the fusion lexical channel, and entity aliasing. The naive Jaccard
  `tokenOverlap` signal deliberately keeps the historical length-4 floor via a
  new `minTokenLength` option: full-suite triage showed short content tokens
  dilute its max-denominator and shift every calibrated overlap score — six
  LongMemEval rules-only floor fixtures moved (some up), and one behavioral
  trace-replay fixture *regressed* (the "avoid DeepAnalyzer" rule fell out of
  context). Distribution-shifting the overlap signal now goes through frozen
  diagnostics as its own measured lever; an anti-dilution guard test pins the
  contract.
- **R1e — per-call `referenceTime`.** Additive on public + engine
  `RecallInput`; anchors plan resolution, temporal claim selection, document
  visibility, and freshness per query (invalid values fall back to the runtime
  clock). Engine test proves visibility flips around a validity boundary.
- **R1f (new finding) — common-word entity filter.** Sentence-initial
  capitalized common words ("Evenings …") became entities and, as singletons,
  earned maximal rarity in the entity channel, outranking true lexical
  matches. Fusion now drops TitleCase single-word aliases that the scope's own
  documents also use lowercase (deterministic truecasing; acronyms, multi-word
  spans, lowercase-native aliases untouched).
- **R3.1–3.2 — event time on the write path.** `FactMemory.observedAt` (earliest
  cited source message) now persists via `buildFact`; the deterministic
  fallback claim prefers `validFrom ?? observedAt ?? extractedAt` so bulk
  ingestion keeps session dates instead of wall-clock time. End-to-end test
  through `remember()` with the preset's write-through path.
- **R3.3 — temporal anchor grammar.** `recallPlan` before/after anchors now
  resolve month names (+day/year), Q1–Q4, seasons (fixed northern-calendar
  starts), "last <month/season/week/month/year>", "N units ago", "yesterday",
  and Chinese 年/月/日 forms against the per-call reference time — pure
  calendar arithmetic, modal-"may" guarded, ISO/bare-year behavior preserved.
- **R4.1 — structural bi-temporal supersession.** On appending a structured
  claim, older *current* claims in the same `(subjectEntityId, predicateKey)`
  slot from other sources with earlier `observedAt` and a different value get
  `validUntil = newer.observedAt` (atomic batch: closed claim + status swap +
  old-claim delete, optimistic-concurrency safe). Generic `fact.*` predicates,
  negations, and non-asserted modalities never participate (unknown
  cardinality — several blockers may be true at once). Tests: residence-change
  closure + generic-namespace guard.

### Measurement pass (2026-07-20 evening, in progress)

- **Instrument:** `eval:phase-62-recall-diagnostic` gained
  `--fusion-min-relative-strength` (strict-validated, recommended-profile
  only). The recorded `runConfiguration.generalizedFusion.minRelativeStrength`
  now always equals the wired value — previous reports recorded the 0.35
  constant while the engine ran 0 (the field was declared but never consumed;
  the Phase 69 gate's expected config was therefore never actually exercised).
  Passing `0.35` reproduces the Phase 69-declared configuration for real.
- **Dataset:** `~/.goodmemory-longmemeval/longmemeval_s.json` was a dangling
  symlink into a deleted Downloads file; re-fetched
  `xiaowu0162/longmemeval-cleaned@98d7416c` and verified SHA-256
  `d6f21ea9…` — exact match to `PHASE69_LONGMEMEVAL_SOURCE_SHA256`.
- **Balanced-subset sweep (18 cases, provider-free recommended profile,
  hermetic clock/ids, `executionFailures: 0` in every arm):** floors 0, 0.35,
  and 0.5 produce **identical evidence-session recall (0.9444 overall,
  identical per type)** while wrong-session admissions drop **2 → 1** at both
  0.35 and 0.5. The dynamic budget trims noise at zero recall cost on this
  subset — the designed behavior, now measured.
- **Paired per-type slice sweep (2026-07-21, identical tree per pair, hermetic
  ids/clock, `executionFailures: 0` everywhere; long background runs were not
  viable on this machine, so slices ran foreground):**

  | floor | temporal-reasoning (n=30) | knowledge-update (n=30) | multi-session (n=20) |
  |---|---|---|---|
  | 0 (current default) | 0.8361 | 0.9000 | 0.7333 |
  | 0.25 | 0.8417 (+0.56) | — | 0.7333 (±0) |
  | 0.35 | **0.8694 (+3.33)** | 0.9000 (±0) | **0.7208 (−1.25)** |

  A completed full-500 floor-0 reference (previous evening's tree): overall
  0.8787 — single-session types 1.000, multi-session 0.787, temporal 0.836,
  knowledge-update 0.865.

  **Verdict under the ≥3pt target / ≤1pt protection rule: no floor is
  promotable as the preset default yet.** 0.35 clears the temporal target
  (+3.33) but regresses the multi-session protection (−1.25, one case's
  partial-session fraction at n=20); 0.25 protects but forfeits the gain. The
  default stays unset (0); the knob remains the measured opt-in lever.

  Two follow-ups from the mechanism (the floor's temporal gain comes from
  *context-budget displacement* — trimming weak fused candidates lets true
  evidence fit the 4000-token render budget): (1) rerun multi-session at
  full n=133 to test whether −1.25 is single-case noise before final
  judgment; (2) a **plan-conditional floor** — apply `minRelativeStrength`
  only when the recall plan carries temporal constraints — is a
  query-structural (ADR-005-clean) refinement that would capture the temporal
  win without touching multi-session paths; needs its own protection pass.

  **Full-type coverage + count-conditional floor (2026-07-21, resolved):**
  paired offset slices covered multi-session n=113 and temporal-reasoning
  n=103 (identical tree per pair, `executionFailures: 0` throughout). Pooled
  unconditional-0.35 deltas: multi-session **−0.44pt** (the earlier −1.25 was
  n=20 amplification), temporal **+0.65pt** (the +3.33 concentrated in the
  first 30 cases). The changed-case sample (8 of 216) separates cleanly on
  structure: **all 3 `aggregateCount` questions regressed, none improved** —
  enumeration counts need breadth, trimming clips instances — while all 4
  improvements are non-count precision questions. That ≥2-case structural
  pattern justified a **count-conditional floor** (never trim under an
  enumeration-count query), now implemented in the engine keyed on the query
  analysis (not the plan — default recalls carry a neutral unplanned plan
  until plan execution is promoted; discovering that also surfaced the
  staging boundary). Empirical validation: the regressor slice under the
  conditional floor is byte-identical to floor-0 (0.8078, zero changed
  cases). Recomputed pooled effect of conditional-0.35: multi-session
  **+0.29pt**, temporal **+0.81pt** — Pareto-positive but below the 3pt
  preset-promotion bar, so the preset default remains unset; the conditional
  mechanism ships as inherent floor semantics, and the knob stays the
  measured opt-in. A same-shape LoCoMo diagnostic is the natural second-family
  check before any preset change. Note: the interval-vs-count plan fix landed
  convergently via the language-pack workstream's `temporalInterval` analysis
  flag; this workstream's failing test now pins it.

  **LoCoMo second-family check (2026-07-21, full root 10/1986/5882, zero
  failures, retrieval-only `--generalized-fusion`):** per-category
  evidence-turn recall on the current tree vs the Phase 69 recorded
  candidate: single_hop 0.3726 (−6.9pt), multi_hop 0.0925 (−4.1pt), temporal
  0.3705 (−13.2pt), open_domain 0.1464 (−12.6pt), adversarial 0.3117
  (−12.4pt); noise/question ~9.4-9.6 (was ~9.2-9.4). **Attribution by direct
  single-conversation ablation (conv-26): this workstream's changes are
  cleared** — neutralizing the common-word entity filter (R1f) is
  byte-identical; restoring the pre-R1d ≥4 token floor is a net wash
  (temporal −2.7 *without* R1d, multi_hop +0.8). Three confounds make the
  cross-era delta non-attributable as a code regression alone: (1) the
  benchmark-root fingerprint differs from the Phase 69 pin (prep script
  changed in `6f8fc73a` and `563bc8c4` after the gate closed); (2) the
  language-pack refactor rewrote entity extraction / analyzers / search
  terms wholesale; (3) the runner's recorded `minRelativeStrength: 0.35` is
  still declared-not-wired here (the smoke memory passes the bare preset), so
  both eras actually ran floor-0 — the floor is exonerated too. **Action for
  the language-pack workstream:** re-run this comparison against a
  fingerprint-matched root to decide how much is data drift vs pack-refactor
  behavior; the per-category table above is the baseline to beat. Runner
  metadata honesty fix (record wired config) is also still owed here.

  **Trigger analysis (2026-07-21, per-case join of the paired slices):** the
  constraint-conditional design is **refuted** — both temporal improvers had
  *no* plan temporal-constraints ("Which event happened first…", "How many
  weeks passed between…"), and only 8/30 temporal-reasoning cases carry
  constraints at all. The changed-case sample instead separates on question
  shape: the improvers are *precision* questions (pairwise ordering; an
  interval question misclassified as `aggregation: count`), while the one
  multi-session regressor is a *true enumeration count* ("How many pieces of
  furniture did I buy, assemble, sell, or fix…") that needs breadth. With
  only 3 changed cases, any conditionality would be single-case fitting
  (ADR-005), so: (a) full-type coverage runs are collecting a real
  changed-case sample; (b) one standalone fix falls out regardless —
  "how many &lt;time-unit&gt;s passed/between" is an **interval** question, not an
  enumeration count, and the plan should not classify it as `count`
  (misclassification confirmed on a live improver; also relevant to BEAM's
  aggregate_count vs temporal families).

- **R6 increment 1 (2026-07-21) — write-time question expansion, retrieval
  side + backfill job.** Cues live under the reserved
  `attributes.retrievalCues` key (newline-joined; `MemoryAttributeValue` has
  no arrays): fact attributes already project as field-granularity recall
  documents, so cues feed the lexical/BM25 channel with zero projector
  change, and the context builder never renders attributes, so cues cannot
  leak into answer context — both properties pinned by tests (a fact whose
  content shares no tokens with the query is admitted through its cue; the
  cue string never appears in the packet). Generation is the opt-in
  `retrievalCues` maintenance job driven by the injected
  `adapters.retrievalCueGenerator` (bounded 16 facts/run, ≤4 cues ≤160 chars
  each, sanitized/deduped, per-fact failure tolerant, idempotent — covered
  facts never re-generate). Increment 2 (`86db625e`) adds
  `createProviderRetrievalCueGenerator` (src/provider/retrievalCueGenerator.ts):
  any OpenAI-compatible chat model becomes the cue adapter — structured
  output, temperature 0, timeout/retry guards, corpus-agnostic prompt.
  Enable with `adapters.retrievalCueGenerator` +
  `runMaintenance({ jobs: ["retrievalCues"] })`. Remaining for full R6: the
  LoCoMo missing-evidence measurement (cue-backfill a conversation corpus
  with a live model, then re-run the admission repair queues — needs the
  paid-validation go-ahead).

- **R2 (2026-07-23) — structured evidence entries + chain-of-note reading,
  code-complete.** Two additive pieces on the eval answer side, both inert by
  default. (1) `EvidenceTurn` gained optional `validity` (caller-formatted
  bi-temporal note, e.g. "superseded 2023-08-01") and `channels` (fusion
  provenance) fields; the pack renders them in the typed entry header
  (`[t=… | #id | role | validity | via lexical+dense]`) and keeps the
  historical byte format when absent (pinned). (2) Opt-in `chainOfNote` mode
  appends a generic reading protocol — one brief note per evidence entry
  citing its `#id` (relevant / background / irrelevant / conflicts-with-#id),
  then a marked `Final answer:` line — and `extractFinalAnswer` strips the
  working notes before strict scoring (last-marker extraction; degenerate
  outputs fall back to the raw text so scoring never sees an artificial empty
  answer). Wired end-to-end into the R2 measurement instrument:
  `eval:phase-65-reanswer-report --chain-of-note` threads the protocol into
  the pack and the LoCoMo answer system prompt, scores only the extracted
  answer, and records `chainOfNote` in the report (record==wire). Guarded
  against the frozen `temporal-bounded-v3` union profile (combining them
  would silently change what that profile measures). Guardrail holds: the
  protocol text is operation/question-type-generic; abstention framing is
  strengthened, not loosened (the notes must state when no entry supports an
  answer). Remaining for full R2: the paid replay measurement on the
  `wrongFullRecallNoisy` / BEAM full-recall buckets, and the BEAM-side runner
  flag once that measurement is approved.

- **R11 increment 1 (2026-07-23) — deterministic evidence-coverage line.**
  When pack entries carry channel provenance (the R2 typed field), the pack
  emits `Evidence coverage: N entries; M corroborated by more than one
  retrieval channel; K single-channel.` — a structural corroboration signal
  the reader can calibrate confidence/abstention against, replacing prose
  tone. Provenance-free entries are never mislabeled single-channel; packs
  without provenance are byte-identical to before. Activates exactly when a
  runner starts passing fusion provenance into the pack.

- **R5 increment 1 (2026-07-23) — episode event time + span pointers.**
  `EpisodeMemory` gained `observedAt` (event time = earliest contributing
  source message, mirroring R3.1's fact stamping; transaction time stays on
  `createdAt`) and `sourceMessageIds` (the non-lossy pointer back to the
  dialogue span, capped at 32, only when the caller supplies message ids).
  "Contributing" = candidate source messages ∪ the assistant-continuity
  messages that justified the episode — an unrelated earlier message does not
  drag the anchor back. The context builder now renders
  `- [YYYY-MM-DD] summary` for anchored episodes (unanchored episodes keep
  the historical byte format, pinned). This is the prerequisite plumbing for
  R5's dialogue-span rendering and for record-level validity on the episode
  fusion lane; the lane itself (quotas) shipped in R1c. Remaining for full
  R5: multi-episode topic segmentation at write time (behavior-changing —
  needs its own measured pass) and span rendering in the evidence pack via
  `sourceMessageIds` → session-archive turns.

  **R2 measurement (2026-07-23, paid validation, complete): chain-of-note is
  NOT promotable as a default — verdict negative on the target bucket,
  positive on protection.** Paired live replay (gpt-5.6-terra, concurrency 4,
  zero execution failures in all 12 runs) on the full-root union report's
  wrong-despite-full-recall-noisy bucket (n=314 non-adversarial: single_hop
  182, temporal 76, multi_hop 30, open_domain 26) plus a 60-row adversarial
  protection sample (45 union-correct + 15 union-wrong), both arms identical
  except `--chain-of-note`. Target: control 0.2229 vs chain-of-note 0.2006 —
  **−2.23pt** (18 fixed / 25 broken; mean token-F1 −2.72pt). Per category:
  multi_hop +3.33 (n=30), single_hop +1.65, temporal **−10.53**, open_domain
  **−11.54**. Protection: abstention *behavior* improved (declines 54/60 →
  58/60, bait-rate 0 in both arms; scored-boolean 1/60 in both — the verbose
  abstention phrasing vs scorer alias-set mismatch affects both arms
  equally). Failure taxonomy from the broken flips: (1) **answer-shape
  drift** dominates the temporal losses — the note pass makes the model
  resolve relative gold phrasings ("the week before X") into concrete dates,
  often defensibly correct but token-F1-fatal; (2) over-terseness ("Yes."
  where gold is "Yes, she is supportive"); (3) two over-abstentions on
  answerable rows. Mechanism read: under strict token-F1, CoN's
  evidence-use benefit is swamped by answer-shape side effects; the
  published +7–10pp CoN numbers are EM/judged-metric results and do not
  transfer to this scoring shape — exactly the external-transfer failure
  mode the plan's measurement-first guardrails exist to catch.
  Dispositions: `--chain-of-note` stays a measured opt-in (never default);
  the abstention-only conditional variant (CoN only for abstention-operation
  questions) is structurally supported by this data (improves the family it
  is known to improve, regresses the others) but needs its own protection
  pass before any promotion; the judged-track LongMemEval replay is the
  right second family if CoN is revisited, since judged scoring removes the
  answer-shape penalty. Artifacts: scratchpad `r2-con/` (source reshape note,
  selection, 12 run reports, flips.json).

  **R6 measurement (2026-07-23, paid validation, two-conversation replication):
  write-time question expansion is a LARGE, category-uniform admission win.**
  Instrument: new `--retrieval-cues` on the phase-65 runner (commit
  `118b97f4`) — after seeding, every stored fact gets cues through the
  shipped `retrievalCues` maintenance job (record → concurrent prefetch →
  replay through the job, so stored bytes match the product path;
  record==wire stats in the report). Paired retrieval-only arms, identical
  tree/config/root (`--generalized-fusion`), gpt-5.6-terra cue generation at
  temperature 0, zero execution failures, all facts cued (458 and 428).
  Evidence-turn recall per conversation:

  | category | conv-26 base → cues (n) | conv-30 base → cues (n) |
  |---|---|---|
  | single_hop | 0.3500 → 0.5643 **+21.4** (70) | 0.2159 → 0.4432 **+22.7** (44) |
  | temporal | 0.4324 → 0.7297 **+29.7** (37) | 0.5385 → 0.8077 **+26.9** (26) |
  | multi_hop | 0.0703 → 0.2344 **+16.4** (32) | 0.0606 → 0.1742 **+11.4** (11) |
  | open_domain | 0.1923 → 0.3077 **+11.5** (13) | — (0) |
  | adversarial | 0.2660 → 0.5000 **+23.4** (47) | 0.2500 → 0.6042 **+35.4** (24) |
  | **overall** | **0.2902 → 0.5101 (+21.98)** | **0.2873 → 0.5421 (+25.48)** |

  Pooled: **+23.2pt** recall on n=304 questions; 88 questions improved vs 9
  regressed; noise/question flat-to-down (cues admit true evidence that
  displaces noise — the same context-budget displacement mechanism the floor
  sweep exposed, now working *for* admission).

  **Answer-side conversion (same day): the recall gain converts.** Live
  answers replayed over both arms' retrieved sets (evidence-pack context,
  strict abstention, no chain-of-note, identical settings per pair; zero
  failures across all 10 runs): conv-26 answer accuracy 0.1960 → 0.3719
  (**+17.59pt**; fixed 43 / broken 8; mean token-F1 +13.19), conv-30 0.2571
  → 0.4095 (**+15.24pt**; fixed 19 / broken 3; mean token-F1 +13.79).
  Per-category deltas positive everywhere that scores: single_hop
  +24.3/+18.2, temporal +21.6/+26.9, multi_hop +18.8/+9.1, open_domain
  +15.4 (conv-26 only), adversarial +4.3/±0 (the near-zero adversarial base
  in both arms is the verbose-abstention-vs-scorer-alias phrasing artifact
  documented under the R2 measurement — equal in both arms, so protection
  holds). Pooled: **+16.8pt answer accuracy on n=304**, 62 fixed vs 11
  broken. Clears the ≥3pt bar ~7× with
  no protection regression (adversarial recall up = better grounded-abstention
  support; noise did not inflate — the R1a floor counterweight was not even
  needed). Guardrail holds by construction: the generator sees only stored
  memory content through the corpus-agnostic prompt (`86db625e`), so cues
  structurally cannot encode benchmark question phrasing. Caveats: (1) the
  baseline is the current tree's depressed post-refactor floor (fingerprint
  drift note above), so absolute levels are not Phase 69-comparable even
  though the paired delta is internally valid; (2) cost is one short LLM
  call per stored fact at maintenance time (~430-460/conversation,
  concurrency 4, ~4-6 min) with zero query-time cost. Next steps in order:
  full 10-conversation run for the claim track (~5.9k cue calls; answer
  conversion measured above), LongMemEval second family.

- **R5 increment 2a (2026-07-25) — episode dialogue-span rendering.**
  Admitted episodes with `sourceMessageIds` now quote their source turns in
  the context packet: an optional `sourceMessages.getByIds` repository port
  resolves ids (storage or caller message ids) scope-filtered in request
  order; the recall engine hydrates ≤2 episodes × ≤6 turns (matching the
  builder's render caps) with per-episode failure tolerance; the builder
  renders `  > [date] role: content` lines under the episode summary,
  clipped like evidence excerpts. Span-free episodes stay byte-identical
  (pinned). Remaining for full R5: multi-episode topic segmentation at
  write time (its own measured pass).

- **R9.4 (2026-07-25) — claim-slot supersession sweep, batch form.** The
  write path's R4.1 supersession only closes slot values older than the
  arriving claim, so out-of-order ingestion leaves two open "current"
  values in one `(subjectEntityId, predicateKey)` slot (pinned by a
  failing-first test). The contradiction maintenance job now also sweeps
  stored current claims: multi-value slots resolve exactly as the write
  path would have (newest observation stays open; stale values close at
  its observedAt through the same closure/status-swap machinery),
  optimistic-concurrency guarded per slot, idempotent, fact.* namespace
  and non-asserted/negative claims excluded. Wired through the projection
  runtime; the fact-level polarity pass is unchanged.

- **R5 increment 2b (2026-07-25) — opt-in time-gap episode segmentation.**
  `buildEpisodes` splits a remember batch at observation-time gaps ≥
  `remember.episodeSegmentTimeGapMs` and synthesizes one episode per
  sitting through the unchanged single-episode logic (per-segment
  candidates, span pointers, event anchors; content-agnostic boundary =
  time, not topic text). Off by default; single-episode behavior pinned
  end-to-end. Measurement (episodes as a retrieval channel with spans +
  segmentation on a multi-session corpus) still owed before promotion.

- **R7 increment 1 measurement (2026-07-25, free paired retrieval,
  two conversations): entity PageRank is a real but non-promotable
  admission lever — ships as measured opt-in.** Instrument: opt-in
  `retrieval.generalizedFusionEntityPageRank` + `--entity-page-rank`
  (bipartite entity-memory PPR, d=0.5, 3 iterations, seeds = query-matched
  entities under the existing rarity×BM25 weights; 2-hop association
  becomes admissible; hub conduits dampen by degree normalization; 1-hop
  channel byte-identical when off, pinned). Paired vs the same-tree
  baselines, zero failures: conv-26 overall +4.40pt (every category
  positive; multi_hop only +0.78, n=32), conv-30 overall +8.89pt
  (multi_hop +7.58 n=11, temporal +19.2, single_hop +10.2, adversarial
  **−4.17**). Pooled n=304: overall **+5.9pt**, 26 improved vs 6
  regressed, noise flat-to-down — but the target family multi_hop pools
  to **+2.5pt (< the 3pt bar)** and adversarial is sign-inconsistent
  (+8.5 / −4.2; conv-30 breaches the ≤1pt protection rule). Verdict: not
  the preset default; the knob stays a measured opt-in. Natural next
  steps: the R6×R7 interaction arm (cues fix lexical admission, PPR adds
  associative admission — likely complementary), and R7 increment 3's
  recognition filter as the designed precision control for the
  adversarial noise this channel adds.

- **R6 FULL-ROOT claim-track measurement (2026-07-25): the write-time
  question-expansion win holds at n=1986 — the queued claim run is
  complete.** All 10 conversations, paired base/cues retrieval arms plus
  answer replay over both retrieved sets (evidence-pack context, strict
  abstention, no chain-of-note), 6729/6729 facts cued, **zero execution
  failures across all 40 runs** (one transient cue-arm hang on conv-42 was
  killed and re-run clean; the resumable driver + artifacts live in the
  session scratchpad `r6full/`). Pooled evidence-turn recall 0.3073 →
  0.5484 (**+24.10pt**; per category: single_hop +27.1, adversarial +28.0,
  temporal +24.1, multi_hop +13.1, open_domain +11.9; 578 questions
  improved vs 39 regressed; noise/question DOWN in every category).
  Answer accuracy under the strict scorer 0.2085 → 0.3580 (**+14.95pt**;
  347 fixed vs 50 broken; mean token-F1 +13.69pt; single_hop +22.1,
  temporal +21.8, multi_hop +12.4, open_domain +7.3, adversarial −0.2 on
  the near-zero verbose-abstention-alias base — noise-level, protection
  holds). This is the ≥3pt bar cleared ~5-8× end-to-end at full-root
  scale with category uniformity and a protection profile that improved.
  Remaining before any headline-number claim: official-protocol scoring
  comparability (the strict scorer here is the repo's own; the recorded
  0.8708 official track uses the upstream judge), and the LongMemEval
  second family. Cost: one short cue call per stored fact at maintenance
  time (~670/conversation), zero query-time cost.

  **Official-protocol comparability (same day, complete): the R6 gain
  EXPANDS under the official judge.** Both full-root answer arms rescored
  with the industry-comparable J-metric judge (mem0ai/memory-benchmarks
  LoCoMo prompt, no-evidence variant, categories 1-4, adversarial excluded
  per that methodology; judge gpt-5.5, answers unchanged, 20 runs, zero
  failures): base 0.4169 → cues **0.6617** on n=1540 — **+24.48pt
  official-judge accuracy** (single_hop +26.5, temporal +25.2, multi_hop
  +20.9, open_domain +14.6). The strict +14.95pt is the conservative floor;
  the official judge credits the paraphrase-shaped correct answers the
  token-F1 scorer rejects, so the mechanism's full conversion chain now
  reads: admission +24.1pt → strict answers +15.0pt → official-judge
  +24.5pt, every category positive at every layer. Comparability caveat:
  these arms run the research profile (provider-free retrieval,
  current-tree floor, evidence-pack replay answers), NOT the 0.8708 claim's
  production stack (provider embedding + reranking + conversational
  extraction) — the paired delta is the valid readout, not the absolutes;
  promoting cues into the production claim stack is the follow-on run.

  **LongMemEval second family (same day, paired 18-case balanced subset,
  7218/7218 facts cued, zero failures): NEUTRAL — no recall movement at
  ceiling.** New `--retrieval-cues` on the phase-62 recall diagnostic
  (postSeed seam + factory adapter, record==wire; cue-only-admission
  property pinned hermetically). Evidence-session recall 0.9583 → 0.9583
  (identical; the 2 multi-session enumeration misses stay missed), 6/18
  cases shifted their retrieved-session sets, session-level noise net +4.
  Mechanism read, not a surprise in hindsight: R6 repairs *turn-granular
  admission* — LoCoMo stores each dialog turn as a fact and its baseline
  recall was 0.31, so cues had 69pt of admission headroom; the LME
  balanced subset retrieves *sessions* at 0.958 baseline — near ceiling,
  nothing for cues to admit, and extra cue matches only shuffle
  low-margin session sets. Disposition: R6 stays a LoCoMo-shaped
  (turn/atomic-fact corpora) admission lever; the LME slice with real
  headroom is the full-500 multi-session type (0.787 recall, n=133,
  ~55k facts to cue) — a larger paid run left to the next budget
  decision. No protection concern at this scale.

  **R6×R7 interaction (same day, paired cues vs cues+PPR, two
  conversations, zero failures): DO NOT STACK.** conv-26 +0.67pt overall
  (multi_hop +8.9 but temporal −8.1, open_domain −3.9; 17↑/13↓), conv-30
  **−8.10pt** (every category negative; 3↑/14↓); pooled ≈ −2.4pt,
  sign-inconsistent, noise flat-to-up. Mechanism: with cues already
  repairing lexical admission, the fixed candidate budget is contested —
  PPR's associative expansions displace cue-admitted true evidence (the
  familiar budget-displacement mechanism, now adversarial). R7's
  standalone gains largely came from filling the same admission gaps cues
  fill better. Disposition: the PPR knob is for cue-less deployments;
  any stacked revisit needs R7 increment 3's recognition filter or a
  measured budget increase first.

- **Runner config honesty (2026-07-25, owed since the floor sweep):**
  phase-65 reports now record the actually-wired fusion floor (bare
  preset = 0, not the 0.35 library constant), and the new
  `--fusion-min-relative-strength` knob threads a sweep floor through the
  preset for the queued LoCoMo floor second-family check.

Verification state at close of the pass: full canonical sweep green — 3,537
unit + 645 integration/scenario/cli/eval/type/consumer + 101 example/release
tests, 0 failures, typecheck clean. One unrelated pre-existing failure was
fixed along the way: `tests/release/release.test.ts` pinned the phase-67
board's old "Current verdict" wording after the board was reworded to
"Historical verdict" (Phase 68 supersession); the test fragments now match the
board's deliberate wording.

  **R6 production-stack promotion (2026-07-26, paired, captioned full
  root, claim configuration: provider embedding + provider reranking +
  conversational extraction + label-free ingest, categories 1-4,
  concurrency 40, temporal-bounded-v3 answers, official gpt-5.5 judge;
  both arms resumed to zero retrieval failures): NOT PROMOTABLE — the
  production stack was never admission-bottlenecked.** Recall 0.8125 →
  0.8356 (**+2.31pt**; noise down ~0.4/question), strict answers 0.6208 →
  0.6420 (+2.1pt; answer-step failures 37 vs 79 — judge scored all 1540
  regardless), **official judge 0.8442 → 0.8390 (−0.5pt, a wash)**. The
  dense retriever + reranker already capture what cues add lexically, so
  the research profile's +24.5pt collapses to noise here. This bounds
  R6's domain precisely: **transformative for provider-free / lexical-only
  deployments (edge, local, no embedding model) and neutral on the full
  provider stack** — the cues job stays opt-in with that guidance, and no
  new headline claim is minted from it. Reference point: the current-tree
  production base scores 0.8442 official vs the v0.6.0 claim's 0.8708 —
  consistent with the root-fingerprint + pack-refactor drift flagged
  earlier (this workstream's changes were ablated clean), still owned by
  the language-pack workstream. Artifacts: scratchpad `prod/`,
  `reports/eval/research/official-rescore/prod-*-official/`.

  **Drift attribution (2026-07-26, single-variable, RESOLVED): the
  "post-refactor floor" was the prep's date normalization, and the current
  tree beats the v0.6.0 claim on a matched root.** The claim-era and
  current roots differ ONLY in the session date format — all 5,882 turns:
  raw upstream strings ("1:56 pm on 8 May, 2023") vs
  `normalizeLocomoDateTime` ISO ("2023-05-08T13:56:00.000Z"); content and
  questions byte-identical. Production base on the claim-era root, current
  tree, zero failures: retrieval recall 0.8252 (vs 0.8125 on the ISO
  root), **official judge 0.8805** — vs 0.8442 on the ISO root and the
  v0.6.0 claim's 0.8708. Conclusions: (1) the ISO date rendering costs
  **−3.6pt official** end-to-end (answer-shape and temporal-resolution
  degradation from machine-format dates in turn markers) — an
  eval-harness regression introduced in `563bc8c4`, NOT a retrieval-code
  regression; (2) the pack refactor is **cleared** — the current tree is
  **+1.0pt over the v0.6.0 claim** on the matched root (0.8805 vs
  0.8708), so the July workstream's landed changes are net-positive on
  the claim configuration; (3) the earlier LoCoMo second-family drift
  note (2026-07-21) is resolved by this attribution. **Fix landed same day:**
  `formatLocomoHumanDateTime` (exact inverse of the normalizer; all
  5,882 root dates round-trip byte-exact to the claim-era raw strings)
  now renders seeded turn markers human-readable while storage keeps
  ISO — the 0.8805 old-root measurement IS this rendering's validated
  effect, since seeded bytes are identical. **Re-pin complete
  (same day): the current tree scores 0.8799 official on the claim
  configuration** (ISO root + both render fixes; zero failures after
  resume; retrieval recall 0.8226). The first re-pin recovered only
  +0.77pt and exposed a SECOND ISO leak — `EvidenceTurn.timeAnchor` read
  the root date directly into pack entry headers, bypassing the marker
  fix; with both render sites fixed the score matches the claim-era
  proof (0.8805) within run noise. **New claimable number: 0.8799
  official (n=1540, gpt-5.5 judge) vs the v0.6.0 claim's 0.8708 —
  +0.91pt — with normalized ISO storage retained.** Artifacts:
  `prod/repin-base`, `official-rescore/repin-base-official/`. Claim-file
  publication is deliberately left to the release process (it rewrites
  public README fragments, evidence projections, and the claim gate, and
  pins a release commit): at release time, rerun the recorded claim
  command chain at the release commit, then update
  `benchmark-claims/locomo.json` readmeRequiredFragments (0.8708 → the
  fresh number) and regenerate the historical evidence projection.
  Caveat: single arm at n=1540 (~answer-model nondeterminism applies),
  but the comparison is same-tree, same-config, content-identical —
  the date format is the only variable. Artifacts: `prod/oldroot-base`,
  `official-rescore/oldroot-base-official/`.

  **R5 episode-channel measurement (2026-07-26, paired free retrieval,
  two conversations, zero failures): NEGATIVE on turn-granular corpora —
  the episode lane displaces evidence.** Instrument: `--episodic-ingest`
  on the phase-65 runner (second speaker mapped to the assistant role
  with a confirmed_or_verified_only retention policy; per-turn
  observedAt/message ids; 6h time-gap segmentation → ~9 per-sitting
  episodes per conversation with span pointers; probe verified every
  evidence-turn fact retained). Paired vs the same-tree baselines:
  conv-26 **−6.28pt** evidence recall (19↑/32↓), conv-30 **−6.03pt**
  (11↑/16↓). Mechanism — the budget-displacement pattern's third
  appearance: admitted episodes are token-expensive packet occupants
  whose few surfaced turn ids do not repay the fact slots they displace
  (same family as the floor sweep's count regression and the R6×R7
  stacking loss). Disposition: episodic ingestion is NOT a LoCoMo lever;
  the episode channel's domain is span-granular retrieval (LongMemEval
  multi-session, product continuation queries — where the phase-62
  diagnostic already exercises episodes through the product path). The
  R5 build increments (spans, segmentation) remain shipped-off-by-default
  product capabilities with their measurement now on record.

- **R9 observation synthesis (2026-07-26) — built, opt-in, measurement
  owed.** New `observationSynthesis` maintenance job: each subject with
  ≥4 active facts gets one compact observation memory through the
  injected `adapters.observationSynthesizer` (inferred provenance,
  `observationOf`/`observationMemberIds` attribute pointers — auditable
  and forgettable through existing fact paths; stable per-subject ids so
  replacement is a same-id overwrite; member-set idempotency; per-subject
  failure tolerance; bounded subjects/run).
  `createProviderObservationSynthesizer` adapts any OpenAI-compatible
  model (generic grounded-synthesis prompt, temperature 0, guards). The
  measurement path is the LoCoMo open_domain slice per §R9 —
  budget-displacement risk applies (observations add index mass), so the
  paired run must watch the same protection families that caught R5/R7.

- **R12.3 paraphrase probe on R6 (2026-07-26, free paired retrieval,
  conv-26, zero failures): the cue mechanism is ANTI-FRAGILE to
  paraphrase — the overfitting critique is refuted.** 194/199 questions
  machine-paraphrased (meaning-preserving, temperature 0; evidence ids,
  turns, and answers untouched). Baseline recall drops 0.2915 → 0.2337
  (−5.8pt: raw lexical matching was partly fitted to original phrasing —
  exactly what this probe detects), while the cues arm holds at 0.5176
  (vs 0.5042-0.5101 on original phrasing), so the R6 delta GROWS to
  **+28.39pt** under paraphrase (vs +21.3-22.0 original). Mechanism:
  cues are multiple natural phrasings generated from stored content —
  never from benchmark questions — so they span the paraphrase space
  that single-phrasing token matching cannot. This is the external
  reviewers' top-named failure mode, tested and passed. Artifacts:
  scratchpad `r12/`, variant root `/private/tmp/LOCOMO-paraphrase`.

- **R11 calibration measurement (2026-07-26, paired adversarial replay,
  zero failures across 6 runs): the provenance-wired coverage line is a
  LARGE abstention win with protection held.** Instrument: retrieval
  reports now record `retrievedTurnChannels` from the fusion trace
  (`collectLocomoTurnChannels`); the reanswer's `--evidence-provenance`
  threads them into the pack, activating the R2 `via` entry headers and
  the R11 deterministic Evidence coverage line. Paired arms on the
  71-row adversarial set (conv-26+30, gold "No information available",
  strict abstention): scored-correct declines **3/71 → 14/71 (+15.5pt;
  12 fixed vs 1 broken)** — the structural corroboration signal
  (single-channel labeling) converts verbose hedges into scoreable
  declines. KILL-rule protection check (conv-30 single_hop+temporal
  answerable, n=70): 0.3714 → 0.3857 (+1.4pt — no trade of grounded
  answers for abstention). Disposition: `--evidence-provenance` is the
  recommended setting for pack-based answer runs; preset-default
  promotion wants the remaining answerable families (multi_hop,
  open_domain) replicated first. R11 is now built AND measured.

- **R10 disposition (2026-07-26): verified where verifiable; the frozen
  LME gate is unreproducible; the standing decision is affirmed.**
  (1) The LoCoMo claim profile DID run listwise: the recommended preset
  resolves `providerRerankingStrategy: "listwise"` whenever a provider
  reranker is configured (`retrievalPreset.ts`, pinned by the preset
  test), and the v0.6.0 claim's own recorded run-id says
  "production-listwise" — R10.1 closed. (2) The previously-failed
  LongMemEval rerank arm (47/64 → 45/64, pointwise era) cannot be rerun
  faithfully: its 64-case cohort manifest predates the phase-62 harness
  and is not in the tree, so the "rerun the exact frozen gate" ask is
  impossible as specified. The decision it gated — **rerank
  LoCoMo-profile-only, keep LME un-reranked** — stands by default and is
  consistent with current evidence (the listwise claim path measures
  0.8799 official; LME balanced-subset recall sits at its 0.958 ceiling
  without reranking). Any future LME rerank revisit needs a NEW
  instrument (phase-62 factory rerank wiring) and a fresh frozen cohort,
  losing comparability with the historical number — recorded here so
  nobody mistakes a new cohort for the old gate. (3) The Phase 74 global
  rerank-pool verification belongs to the Phase 74 workstream; the local
  cross-encoder (R10.3) stays an optional future build.

- **R8 (2026-07-26 historical implementation; raw reports no longer
  available).** Multi-hop
  recall gains evidence-conditioned sub-query generation:
  `adapters.followUpQueryGenerator` plugs into `iterativeRecall`'s
  existing `expandQuery` seam — it reads hop-1 evidence and writes one
  focused follow-up for the missing link (or null to stop), replacing
  the lexical bridge expansion that was measured to hurt. Failure
  tolerant (single pass preserved), bounded by the existing hop ceiling
  and no-new-evidence stops, merged through the shared decomposition
  merge path; `createProviderFollowUpQueryGenerator` adapts any
  OpenAI-compatible model with a generic missing-link prompt. Off
  without the adapter; rules-only unchanged. Measurement path: the R7
  multi_hop queues (paired conv-26/30 with `--multihop` + a runner
  adapter flag) — and per §R8's own note, compare against R6 cues first:
  cues already moved multi_hop +13.1pt full-root, so R8 must beat the
  cue baseline, not the naked one, and the R6×R7 stacking negative
  warns that hop-2 candidates contest the same budget.

  **R8 historical reported measurement (2026-07-26, paired, two
  conversations, zero
  failures): follow-up generation was reported as a composing multi-hop
  lever on top of cues.** Instrument:
  `--follow-up-queries` (requires `--multihop`) wires the provider
  generator into recall. conv-26: follow-up vs base +12.19pt overall
  (multi_hop +3.91; lexical bridging manages only +1.30); **stacked on
  cues: +6.20pt overall / +7.29pt multi_hop** (0.5209 → 0.5829).
  conv-30 replication: **+6.16pt overall / +4.24pt multi_hop**,
  adversarial +4.17 (protection positive). Pooled n=304: **+6.19pt
  overall, +6.51pt multi_hop** on top of the cue baseline — unlike PPR,
  the second hop admits evidence cues cannot reach (relation chains),
  so the two compose. Costs: one LLM call per query (latency) and noise
  +3-4 turns/question. Disposition: measured opt-in — the query-time
  cost and the noise rise keep it off the preset default until the
  answer-side conversion and a noisy-full-recall protection pass are
  run (the R2 taxonomy warns noise-sensitive scoring can eat the recall
  gain). The underlying `/private/tmp` reports were never committed and
  no longer exist. The numbers remain provenance for the next experiment,
  not a currently reproducible scored artifact.

  **R5 verdict CORRECTED (2026-07-26):** the −6.28pt episodic-ingest
  result was confounded — the live factory call never passed
  `episodicIngest`, so the arms ran without the permissive assistant
  policy and dropped derived assistant-turn facts (the exact confound
  the design probe flagged). With the wiring fixed the paired conv-26
  result is **−1.01pt: near-neutral, not strongly negative.** The
  disposition (off by default; span-granular corpora are the domain)
  stands, but the mechanism is cheaper than previously recorded and a
  conv-30 + answer-side pass could revisit it.

### Program status at close (2026-07-25)

Every recommendation now has a resolved disposition:

- **R0** gate run (done, earlier pass). **R1a-f** built; floor sweep measured
  → count-conditional floor ships as inherent semantics, knob stays opt-in.
  **R2** built; measured NEGATIVE on the strict track (−2.23pt) → opt-in
  only; judged-track replay is the revisit condition. **R3.1-3.3 / R4.1**
  built (write-path event time, temporal grammar, structural supersession).
  **R5** built through increment 2b (episode spans + opt-in time-gap
  segmentation) and measured 2026-07-26: NEGATIVE on turn-granular
  LoCoMo (−6.3/−6.0pt, budget displacement) → off by default, domain =
  span-granular corpora. **R6** built and
  measured at every layer and on both stacks: research profile full-root
  recall **+24.1pt** / strict **+15.0pt** / official **+24.5pt** (n=1540);
  LME second family neutral (session-granular ceiling); production claim
  stack **neutral** (+2.3pt recall, official −0.5pt wash — the dense
  retriever already covers the lexical admission gap). Final disposition:
  the cues job ships opt-in, recommended for provider-free / lexical-only
  deployments where it is transformative; no production-claim change. **R7** increment 1 built;
  measured +5.9pt overall but multi_hop below the family bar, adversarial
  sign-inconsistent, and stacking with R6 is net-negative → opt-in for
  cue-less deployments; recognition filter (increment 3) is the revisit
  condition. **R9.4** built (claim-slot sweep in the contradiction job); R9
  observation synthesis built 2026-07-26 (opt-in job + provider adapter,
  measurement owed on the open_domain slice). **R11** built and measured 2026-07-26: provenance-wired packs
  +15.5pt adversarial scored-abstention with answerable protection
  positive — recommended for pack-based runs. **R8** built AND measured 2026-07-26: composes with cues (+6.2pt
  overall / +6.5pt multi_hop pooled on top of the cue baseline) —
  measured opt-in pending answer conversion + noise protection. **R10** dispositioned 2026-07-26 (listwise verified; frozen LME gate
  unreproducible — LoCoMo-profile-only reranking stands). **R12.3** run 2026-07-26 (paraphrase probe: R6 anti-fragile, +28.4pt
  under paraphrase); R12's other items are release-process practices
  (multi-seed and fixed confounds already policy in the Phase 74 gate).
  The final sentence in the original closeout called **R8 / R10**
  "unstarted" even though the same log records both as built or
  dispositioned. That sentence was stale and is superseded by the explicit
  per-item dispositions above.

Verification at close: unit+integration sweep 5105 pass / typecheck clean
(the only failure is a parallel workstream's uncommitted in-flight file,
`codex-coding-effect.c6-package-closure-materializer-cli.test.ts`).

### Source audit and paper refresh (2026-07-30)

This pass answers a narrower question than a leaderboard comparison: when
another memory system reports a higher number, which part is an architectural
signal that GoodMemory should test, and which part comes from a different
answer model, judge, context budget, prompt, split, or unavailable managed
implementation?

#### Reproducible source/protocol audit

All conclusions below are tied to immutable source revisions. A headline is not
treated as a GoodMemory regression unless the question set, answer model,
judge, prompt, retrieved-context budget, and scoring contract match.

| System | Locked evidence and reported result | Why the headline is not directly comparable | Mechanism worth testing in GoodMemory |
| --- | --- | --- | --- |
| Hindsight | Core [`a90f922`](https://github.com/vectorize-io/hindsight/tree/a90f9223765af3c8ad5692ce2b9fa22efbb656ba), AMB [`aa9273a`](https://github.com/vectorize-io/agent-memory-benchmark/tree/aa9273ab9e34bbeaff3c6ef2f694142a552d5b22): LongMemEval 473/500 (0.946), LoCoMo 1417/1540 (0.9201) | The published artifacts use Gemini 3.1 Pro for answers, Gemini 2.5 Flash Lite for judging/extraction, and average retrieved contexts of about 43.6K / 36.2K tokens. The source permits up to 32,768 fact tokens plus 16,384 raw-chunk tokens. This is not GoodMemory's frozen model/judge/budget protocol. | Four independently admitting semantic, BM25, graph, and temporal arms; true union by RRF; time-bucket coverage; bounded reranking; structured facts retaining raw-source fallback. |
| Mem0 Platform v3 | Core [`760dca6`](https://github.com/mem0ai/mem0/tree/760dca6f391277d79c3c7d2096c1bf1d037526c3), benchmark [`4b61c5d`](https://github.com/mem0ai/memory-benchmarks/tree/4b61c5d31b9c668a12b4f5e78064248a02c82d2b): README says LongMemEval 0.944/0.948 and LoCoMo 0.925/0.918 at top-200/top-50 | The claims are for the managed v3 platform. The pinned per-question artifacts are older and lower (LongMemEval 0.934/0.904; LoCoMo 0.9156/0.8266), the latest change does not include matching new outputs, managed temporal APIs are not implemented in the OSS path, and the benchmark answer/judge prompts contain benchmark-specific answer rules and a deliberately permissive judge. | Completeness-biased additive extraction and entity linking are plausible write-side ablations. Do not copy the prompt literals or call its semantic-candidate reranking a true hybrid admission union. |
| LazyMem | Source [`af41099`](https://github.com/allacnobug/LazyMem/tree/af4109960aacb90d6dba994e9103a36a165cc380), paper [arXiv:2607.22690](https://arxiv.org/abs/2607.22690): 0.85 on a LongMemEval 100-question test split and 0.68 on a 314-question LoCoMo subset | It does not score the official full LongMemEval-500 or LoCoMo-1540 protocols. Its 360/40/100 LongMemEval split trains and selects a query-conditioned 4B policy with gold-support supervision; datasets, weights, annotations, checkpoints, and result artifacts are not released. | Broad dense+BM25 RRF union, neighbor-window restoration, then query-time KEEP/compress/deduplicate/chronological assembly over raw history. Test the inference contract before considering any trained controller. |
| swafra | Source [`669e7bd`](https://github.com/kunal12203/swafra/tree/669e7bdbcbcd421deb172a05f8fe52b741c0e915), advertised 94.7% | The number is session-retrieval recall, skips abstention, and is not end-to-end answer QA. | No score-driven change. Its result is useful only as another reminder to keep retrieval, answer conversion, and abstention metrics separate. |

The most important negative finding is that there is no missing universal
"graph memory" primitive. GoodMemory already has independent generalized
fusion, entity adjacency, temporal/claim projections, episodes, raw evidence,
iterative follow-up, and a listwise reranker. Adding a new graph database,
service, or parallel memory truth would duplicate existing boundaries without
explaining the remaining LoCoMo open-domain/multi-hop misses.

The most useful competitor delta is narrower:

1. Hindsight protects admission diversity and temporal coverage before
   reranking. GoodMemory should test time-bucket coverage inside the existing
   candidate arms, not import Hindsight's storage stack.
2. LazyMem separates broad lossless retrieval from query-time evidence
   construction. GoodMemory should test a bounded evidence refinery over the
   existing candidate set, always retaining raw-source pointers and a fallback.
3. Mem0's high managed score is a protocol/configuration lead, not evidence
   that its OSS retrieval architecture is stronger. Its completeness-oriented
   extraction is testable; its benchmark-specific answer literals are not.

#### What the newer papers change

| Paper | General lesson | GoodMemory interpretation |
| --- | --- | --- |
| [S2G-RAG](https://arxiv.org/abs/2604.23783) | Retrieval should stop on structured sufficiency and expose missing information slots. | Add a missing-slot/stop decision to the already bounded R8 follow-up loop; do not add another retrieval controller. Its gold-support training means the contract, not its headline, is transferable. |
| [Over-Searching](https://aclanthology.org/2026.eacl-long.361/) | Extra search can improve answerable questions while hurting abstention and noise robustness. | Every multi-hop recall gain must report calls, added noise, answer conversion, and abstention protection. R8's +3–4 turns/query is an unresolved cost, not a footnote. |
| [SURE-RAG](https://arxiv.org/abs/2605.03534) | Interpretable sufficiency signals can beat fixed retrieval depth in-domain, but external results can reverse. | Start with deterministic evidence coverage and missing slots; do not train a benchmark-fitted classifier first. |
| [TrustMem](https://arxiv.org/abs/2606.25161) | Memory writes need coverage, preservation, and faithfulness checks. | Reuse the contract for derived observation writes only. Do not put an LLM verifier or RL loop on explicit/raw memory. |
| [MemoryArena](https://arxiv.org/abs/2602.16313) | Systems near saturation on static recall can still fail interdependent agent tasks. | Protect against optimizing only LoCoMo/LongMemEval. Agentic task success belongs in the promotion gate. |
| [LongMemEval-v2](https://arxiv.org/abs/2605.12493) | Stronger tests emphasize context gathering and substantially larger histories. | Use it as a generalization/protection family before promoting a benchmark-tuned read path. |
| [MemDelta](https://arxiv.org/abs/2606.29914) | Backbone/embedding changes can move memory scores materially. | Freeze answerer, judge, embedding, prompt, temperature, top-k, and token/call budget before attributing a delta to memory. |
| [Useful memories become faulty](https://arxiv.org/abs/2605.12978) | Rewriting a useful memory can convert it into a future fault. | Prefer additive derived observations with provenance over destructive canonical rewriting. |

No reviewed paper demonstrates one mechanism improving every benchmark family.
The evidence instead supports selective retrieval, explicit sufficiency, and
non-destructive evidence preservation, each with a protection suite.

#### Next experiment queue (minimal, ordered)

1. **R8 sufficiency gate:** on the existing follow-up-query path, compare the
   current fixed hop bound with a structured evidence-sufficiency/missing-slot
   stop gate. Primary metrics: multi-hop answer accuracy, added turns, provider
   calls, latency, and adversarial abstention.
2. **Current-value assembly isolation:** hold the candidate ids and order fixed;
   compare raw-turn assembly with claim/current-value assembly. This isolates
   answer conversion from retrieval and avoids taking credit for a different
   candidate pool.
3. **Risk/coverage curve:** turn the existing EvidenceLedger signals into a
   scored selective-answer analysis. Report accuracy versus coverage rather
   than selecting a single threshold on the target set.
4. **Evidence-refinery factorial:** raw only; raw+atomic; raw+episode;
   raw+observation; and raw+query-time refinement. Include a shuffled
   observation negative control and always keep a raw fallback.
5. **Derived-write transition verifier:** verify only observation/consolidation
   transitions for coverage, preservation, and faithfulness. Do not place it
   on explicit facts or raw source retention.

Promotion rules for all five:

- no benchmark name, category, gold answer/evidence, case id, or literal answer
  rule in runtime code;
- freeze source commit/fingerprint, model, judge, embedding, prompt,
  temperature, top-k, token budget, call budget, and candidate ids as
  appropriate;
- change one variable and report retrieval, answer, and write-side attribution
  separately;
- use paired bootstrap or McNemar where applicable; repeat nondeterministic
  arms three times and across two model families before a default change;
- promote only when at least two benchmark families move in the same direction
  and abstention, temporal/update, noisy-recall, and agentic protections hold.

#### Runtime defect found by the research replay

The full-root concurrent LoCoMo diagnostic exposed a general runtime bug rather
than a score lever: query-time `factKind` / `scopeKind` inference and fallback
`subject` materialization were being spread into the recall result and then
persisted by the low-risk access touch. That changed canonical projection input
during concurrent reads, repeatedly rotated the scope manifest, and caused
projection compare-and-set failures.

The fix keeps query-time classification in the returned recall view, reloads
the canonical fact before persisting only touch metadata, treats fact/feedback
touch counters as projection-neutral, serializes deferred same-source writes,
and reuses an already-dirty generation for the same projection build. The
focused touch/projection suite is 72/72 green, typecheck is clean, and the
previously failing fixed LoCoMo conversation completed 199/199 questions at
concurrency 10 with `executionFailures: 0`. The fixed full-10 replay then
completed 1,986/1,986 questions at concurrency 10 with
`executionFailures: 0`.

The canonical `bun test` sweep completed with 6,067 pass, 52 skip, and 18
failures. The three C6 protocol-readiness timeouts passed 3/3 when rerun alone.
The remaining 15 failures are outside the changed recall/projection paths: six
require Bun 1.3.12 while the local runtime is 1.3.11, eight require the absent
frozen C6 reviewer-actor root under `/private/tmp`, and one existing C6
source-v4 fixture reaches a clean `git commit` with nothing to commit. The
repository therefore is not reported as globally green.

This is runtime/recovery proof only. Concurrency changes the order in which
touch metadata becomes visible to later questions, so this run is not a valid
retrieval-score comparison and creates no new benchmark or public claim.

### R8 structured-sufficiency experiment (2026-07-31)

This experiment implemented the first item in the refreshed queue and then
stopped when its held-out result failed the promotion rule. It did not add a
controller, service, database, benchmark label, category label, gold answer, or
gold-evidence input.

#### Contract and obvious defects fixed first

- The old `string | null` follow-up result conflated “the evidence is
  sufficient,” “no useful query exists,” and “the provider failed.” It was
  replaced cleanly by one discriminated decision:
  `sufficient:true + missingSlots:[]`, or
  `sufficient:false + missingSlots:[one standalone retrieval query]`.
  Provider failure remains `null` internally and is traced as
  `decision_unavailable`; there is no legacy union or duplicate
  `followUpQuery` field.
- A third-hop decision previously saw only the latest hop. Iterative recall now
  supplies cumulative evidence.
- `no_new_evidence` previously deduplicated by content, incorrectly collapsing
  different fact IDs with identical text (a real temporal/provenance case).
  It now uses fact identity.
- The Phase 65 resume fingerprint omitted the follow-up arm, so a checkpoint
  from a non-follow-up run could be reused by a follow-up run. Follow-up-only
  retrieval runs also did not checkpoint despite paid provider calls. The
  report/checkpoint contract now records an explicit
  `off | query_only | structured_sufficiency` mode and enables checkpointing
  for both provider-backed modes.
- Each question now records the bounded decision trace: hop queries, fact
  counts, sufficiency decision, stop reason, and logical decision-call count.
  This is enough to distinguish early sufficiency, unchanged queries,
  no-new-evidence stops, and provider failure. Transport retries/tokens are not
  yet exposed by the provider runtime and are not claimed.
- The first full-suite replay exposed one runner regression: trace collection
  assumed every valid/custom recall result had `metadata`, so three packet-mode
  questions were converted into false recall failures. The collector now
  treats absent metadata as “no follow-up trace”; the isolated packet and
  concurrency regression is green.

The generic v2 prompt requires explicit support for every part of the question,
forbids filling omitted links from outside knowledge, and requires a missing
slot to differ from the original question and target exactly one unresolved
entity/value/relation. A source-level regression test forbids benchmark names,
category labels, and gold fields in the request.

Protocol freeze:

- repository HEAD: `11fb12590d8f70e942934cbfd1b227f09dc46682`;
- five-file runtime/runner content fingerprint:
  `ded4ba981c95fe9a015c2cba1c2d126b23fee6950f5d59443edd7ed70df59991`;
- normalized LoCoMo fingerprint:
  `87abd829cbb3bd5110f80ae1df6c42338ca338b131fac48919ed171d46cb7692`;
- `cases.json` SHA-256:
  `edf70af6cb0fdf2eed50e2f7e69730b9ddadfadce2bee3bebdb141796208317d`;
- retrieval: generalized fusion, no retrieval cues, max two passes, one
  logical follow-up call per question, concurrency 1–2;
- non-judge model: `gpt-5.6-terra` through the configured Gurki gateway;
- all recorded runs had zero execution failures.

The no-cues profile was intentional for the first mechanism isolation. It is
not comparable to the historical on-top-of-cues R8 numbers and cannot validate
that deleted artifact.

#### Development slice and one allowed prompt correction

On conv-26 + conv-30 multi-hop (n=43), historical query-only produced evidence
recall `0.13450` with 603 noise turns. Structured v1 produced `0.08605` with
495 noise turns: noise improved by 108 turns (`-2.51/question`), but recall
regressed by **4.85pt**. Its trace exposed five sufficiency stops and eight
unchanged-query stops. A small conv-30 answer replay was `0/11` query-only
versus `1/11` structured, but one nondeterministic 11-question replay is not
confirmatory evidence.

One mechanism-level correction was allowed before freezing the held-out slice:
the prompt made explicit support the sufficiency criterion and prohibited
restating the original question. No benchmark result, answer, evidence label,
or case-specific literal entered the prompt.

#### Held-out result and disposition

Conv-41 multi-hop (n=31) was not inspected before the v2 prompt was frozen:

| Arm | Evidence recall | Fully retrieved | Noise turns | Logical decision calls |
| --- | ---: | ---: | ---: | ---: |
| single pass | 0.11398 | 1 | 301 | 0 |
| historical query-only | 0.20000 | 1 | 455 | 31 |
| structured sufficiency v2 | 0.16774 | 2 | 438 | 31 |

Structured v2 remained better than single pass (`+5.38pt` recall), confirming
that a second hop is useful. It was nevertheless worse than query-only by
**3.23pt**, while removing only 17 noise turns (`-0.55/question`). Its stops
were 26 max-hop, two no-new-evidence, two sufficient (one without full gold
evidence), and one unchanged query. Query-only had 29 max-hop, one
no-new-evidence, and one sufficient stop.

Disposition: **reject structured sufficiency as a default or score
improvement.** Keep the explicit opt-in experiment contract and telemetry, but
do not tune the prompt again on LoCoMo, do not expand to the full dataset, and
do not make a public benchmark claim. The existing query-only R8 arm remains
the stronger multi-hop treatment under this protocol; its answer conversion,
on-top-of-cues reproduction, latency, and protection requirements remain open.

#### Verification boundary

- `bun run typecheck`: passed.
- Seven focused decision/iterative-recall/runner files: 93 passed, 0 failed.
- Packet context/concurrency regression after the metadata fix: 2 passed,
  0 failed.
- The canonical full sweep before that one-line fix completed with 6,075 pass,
  52 skip, and 16 fail across 6,143 tests. The LoCoMo failure reproduced alone
  and is the packet regression fixed above. The remaining 15 failures are the
  same C6 environment/evidence prerequisites outside these paths: six require
  Bun 1.3.12 while this machine has 1.3.11, eight require the absent frozen
  reviewer-actor root under `/private/tmp`, and one source-v4 fixture reaches a
  clean `git commit` with nothing to commit. The 15-minute full sweep was not
  rerun after the isolated fix, so the repository is still not reported as
  globally green.

#### Additional paper mechanisms reviewed

- [DynaKRAG](https://arxiv.org/abs/2607.06507) supports separating valid actions
  from learned utility, but its controller uses dataset-specific gold-support
  supervision. GoodMemory should keep hard validity rules and not add a learned
  controller while the simple gate fails held-out.
- [Don’t Ask the LLM to Track Freshness](https://arxiv.org/abs/2606.01435)
  supports authoritative version resolution after retrieval, but its own
  LongMemEval counterexample shows that `max(timestamp)` is not universal.
  The next experiment must compare LLM, authoritative-order, and
  hybrid-abstain assembly over the exact same candidates.
- [NEMORI](https://arxiv.org/abs/2508.03341) makes prediction-error residuals a
  plausible semantic-memory treatment, but its LongMemEval knowledge-update
  regression makes KU a mandatory kill-rule protection.
- [TriMem](https://arxiv.org/abs/2605.19952) supports raw-source + atomic fact +
  profile layering, but its prompt optimization consumes LoCoMo evaluation
  outputs. Only the representation factorial transfers; the optimized prompt
  and headline do not.
- [Zep/Graphiti](https://arxiv.org/abs/2501.13956) supports bitemporal
  invalidation with history retention, but its published pipeline changes
  extraction, graph construction, reranking, and context together. GoodMemory
  should isolate valid-time filtering on a frozen candidate pool.
- [Supersede](https://arxiv.org/abs/2606.27472) is useful as an update-pressure
  probe, not a reason to add RL. First run bounded-context current/history,
  late-arrival, retraction, and equal-time cases against the existing claim
  projection.

The next priority is therefore the already-planned current-value/temporal
assembly isolation, not another R8 prompt iteration.

### R3 current-value / temporal assembly isolation (2026-07-31)

This pass found a benchmark-integrity defect before it found a score lever. The
integrity defect takes precedence over every LongMemEval number previously
listed in this document.

#### Official source and frozen inputs

- official LongMemEval source:
  `xiaowu0162/LongMemEval@9e0b455f4ef0e2ab8f2e582289761153549043fc`;
- cleaned Full-500 raw SHA-256:
  `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`;
- canonical parsed-data fingerprint:
  `195fa256c468ff68079f5a05de2572deb47fa2c06b5d48e1d3ad4f3e044a5203`;
- the official dataset contains 500 cases, including 78 knowledge-update and
  133 temporal-reasoning cases.

Every one of the dataset's 948 gold session references begins with
`answer_`; every one of the 500 cases contains at least one such marker. The
official generation path uses session IDs only for lookup and presents ordinal
`Session N` labels to the reader.

#### Claims withdrawn and defects fixed first

GoodMemory did not preserve that boundary:

1. The historical `goodmemory-rules-only` path used
   `historical-annotated` ingestion, including `answer_session_ids` /
   `has_answer` information. Its 0.720 / 0.888 artifacts are answer-aware and
   are withdrawn.
2. The later `label-free-raw` path removed explicit answer annotations but
   wrote `[LongMemEval session ${sessionId}]` into canonical memory content.
   Since gold IDs use `answer_*`, this marker entered indexing, retrieval, and
   reader context. Its 0.762 source and derived 0.924 rescore are also
   withdrawn. Re-scoring stored answers cannot repair source-input leakage.
3. Full-context and label-free reader-visible session labels now use ordinal
   IDs. Raw IDs remain only in internal scope/provenance fields. Tests use a
   real-style `answer_secret` ID and assert that it never reaches either
   reader context.

The same defect-first pass fixed the general temporal path rather than adding
benchmark rules:

- before/current document visibility now uses the query boundary; after uses
  current visibility so post-boundary evidence is not filtered out;
- current-as-of queries load claim history, and the evidence ledger retains
  selected historical peers through rerank-pool reconstruction;
- an explicit evidence ID mismatch no longer falls back to attaching the wrong
  claim;
- rules-only selection excludes inactive, expired, and future-valid facts and
  orders mutable values by `validFrom ?? observedAt ?? updatedAt ?? extractedAt
  ?? createdAt`;
- evidence chronology uses valid time before observation time;
- write-side structured supersession now uses `validFrom ?? observedAt` in
  append, rebuild/reconcile, and maintenance sweep paths, covering future
  effective changes and retroactive late ingestion;
- knowledge-update questions that explicitly ask for a historical value or
  date no longer receive a forced “latest value” guide;
- the LoCoMo live answer path now passes the already-computed retrieval-channel
  provenance into EvidencePack, activating its existing corroboration and
  coverage signals.

#### Rejected first protocol

The first frozen-session prototype was adversarially audited before live use
and then deleted. It expanded the contaminated historical report's selected
sessions into 18k–30k-token raw contexts even though the source run had a
4,000-token context budget, exposed raw session IDs, and bypassed the current
recall runtime. It could only have measured a newly invented raw-reader format,
not replayed 0.762 or isolated a GoodMemory mechanism. No live model call was
made under that protocol.

#### Current-recall paired protocol

The v1 replacement ran the actual current `goodmemory-recommended`,
`label-free-raw` path:

1. seed and recall once per question;
2. freeze the resulting recall packet, candidate traces, and EvidenceLedger
   under one SHA-256 snapshot;
3. render the default product context and `compact_json` EvidenceLedger from
   that exact recall object;
4. enforce a 4,000-token build budget and a 6,000-token pre-answer hard cap;
5. remove gold answer, answer-session IDs, haystack, and question type from the
   answer-generator input;
6. alternate arm order; if the two contexts are byte-identical, answer once
   and reuse the result so model sampling cannot create a fake delta;
7. write output exclusively, bind dataset/selection/source fingerprints, and
   require source state to remain unchanged through the run.

The development and candidate-holdout IDs were selected before any new answer
result by ascending `SHA-256(salt + NUL + question_id)` within strata. The
development slice has eight knowledge-update and eight temporal-reasoning
questions. The 32-question holdout is disjoint and adds sixteen non-target
protection questions; it remains hard-sealed in the runner.

A real-data no-model dry run completed 16/16 current recalls. Maximum default
and compact contexts were approximately 3,230 and 3,262 estimated tokens;
10/16 contexts changed, while six identical contexts correctly share one
answer.

Superseded v1 development live result:

| Arm | Correct | Accuracy |
| --- | ---: | ---: |
| product default | 13/16 | 0.8125 |
| compact EvidenceLedger | 14/16 | 0.8750 |

Paired result: **1 win / 0 losses / 15 ties**, 26 answer calls, eight judge
calls, and 16 memory-context builds. The sole flip was temporal-reasoning:
default answered a 21-day interval as 26 days, while compact EvidenceLedger
answered 21 days; its context was also smaller (2,996 → 2,900 estimated
tokens). Knowledge-update had five changed contexts but zero flips.

Artifact:
`reports/eval/research/phase-72/longmemeval-current-recall-assembly/run-phase72-current-recall-assembly-development-v1/report.json`,
SHA-256
`4ad2e1b070d287e4572fc6b94e92c6bf6e72823bdbd8cd54f502cd61358426ff`.
The run used `gpt-5.6-terra` answers and an independent `gpt-5.5` judge through
the configured Gurki gateway. Its source tree was dirty and only partially
identity-bound: the status and tracked diff were hashed, but the then-untracked
runner bytes were not. This already disqualified it from holdout evidence.

A post-run adversarial review found a stricter boundary defect: v1 removed gold
fields only from the answer generator. The memory builder still received the
raw `answer_*` session IDs, `has_answer` turn markers, answer, and question type.
The built-in label-free branch did not intentionally select on those fields,
but the protocol could not prove a gold-blind memory build. Therefore the v1
result is superseded and cannot authorize holdout opening.

Protocol v2 now:

1. passes the memory builder an answer-free, type-free case;
2. removes `has_answer` from every source turn;
3. replaces every source identity with an ordinal `session-N` before memory
   storage, projection, recall, and context rendering;
4. requires an explicit `--open-candidate-holdout` flag plus a clean 40-character
   Git commit before a candidate holdout can start;
5. pins the development selection to SHA-256
   `3df24634d8f661ad2a6a054ec628114fcbab038d5b130e41800ab1b64a11e29e`
   and the disjoint candidate holdout to
   `7f776aad5ee6c531b7443a060d9323dde53c137f1d849ba87f31313c21f62993`;
6. authorizes holdout opening only from a clean v2 development report on the
   same commit, dataset, answer/judge identities, token budgets, and retrieval
   profile, with 16 unique cases and positive net wins;
7. rejects injected dependencies and non-canonical output paths for holdout,
   reserves the run directory before any model call, and consumes a
   protocol/dataset/selection-keyed one-shot reservation before recall;
8. predeclares the candidate gate as at least two overall net wins, exactly 16
   protection cases, and zero protection losses. Passing one sealed draw is
   still diagnostic evidence, not promotion or a public score.

#### Clean v2 development result and disposition

The gold-blind v2 development replay ran from clean commit
`466517c7a022c6c142ed67c9ab02322272cf5553` under Bun 1.3.14. It kept the
frozen 4,000-token build budget, 6,000-token reader cap, `gpt-5.6-terra`
answerer, and independently configured `gpt-5.5` judge.

| Arm | Correct | Accuracy | Total estimated context tokens |
| --- | ---: | ---: | ---: |
| product default | 12/16 | 0.7500 | 36,721 |
| compact EvidenceLedger | 12/16 | 0.7500 | 42,541 |

The paired result was **0 wins / 0 losses / 16 ties**. Nine contexts differed
and four hypotheses differed, but no answer crossed the correctness boundary;
seven contexts were byte-identical and shared one answer call. Knowledge-update
was 8/8 in both arms and temporal-reasoning was 4/8 in both arms. The run used
25 answer calls, eight judge calls, and 16 memory-context builds. Despite its
name, the compact arm expanded the total rendered context by 5,820 estimated
tokens on this slice.

Artifact:
`reports/eval/research/phase-72/longmemeval-current-recall-assembly/run-phase72-current-recall-assembly-development-v2-bun1314-clean/report.json`,
SHA-256
`48904b86169e5ff6caf58e3c2638a7826c594f05e839153acff559d5e9762233`.
The report binds the clean source worktree fingerprint
`6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d`,
dataset raw SHA-256
`d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`,
and canonical benchmark fingerprint
`195fa256c468ff68079f5a05de2572deb47fa2c06b5d48e1d3ad4f3e044a5203`.

The four development failures do not support another assembly-format edit.
Three lacked one required event endpoint in the retrieved sessions: the coffee
maker purchase, the time-management workshop, and the networking event. The
fourth retrieved both dated endpoints but answered relative to the 2022-04-15
question date. The source says the baking class was on 2022-03-20 and the
birthday cake was made on 2022-04-10, so the expected 21-day event-to-event
interval is correct. This is a temporal-operand/anchor failure, not a benchmark
label defect.

Disposition: **the compact EvidenceLedger assembly hypothesis is rejected on
development and is not promoted.** Net wins were not positive, so the explicit
authorization condition failed and the 32-question candidate holdout remains
sealed. This run creates no LongMemEval score or public claim.

#### Next development-only retrieval experiment (pre-registered)

The next experiment targets the observed general failure class without adding
LongMemEval rules or another provider call. It will derive explicit temporal
operands from question surface grammar: `order(A, B)` for event comparisons and
`elapsed(A, anchor?)` for elapsed-time questions. Those operands become focused
facets for the existing decomposed-recall path; the merged result then uses the
unchanged product-default renderer. The first experiment measures endpoint
coverage only and does not add deterministic date arithmetic.

Frozen constraints before any new model call:

- operands come only from deterministic English query grammar in this first
  experiment; other language packs keep their current behavior. Benchmark
  name, question type, case ID, activity-title lists, gold answer, and gold
  evidence remain unavailable to runtime code;
- at most the primary recall plus two focused operand recalls; no follow-up
  model or learned controller is used;
- the report run ID is separate from memory identity. Both arms reuse v2's
  canonical memory namespace, scope run ID, gold-blind question-ID transform,
  retrieval profile, context caps, and source-identity sanitization;
- control is single-pass product-default recall; treatment changes only the
  query-derived operand admission step, not top-k, answer, or context prompts;
- elapsed-question count classification and deterministic date arithmetic are
  explicitly out of scope, so they cannot contaminate this operand-only arm;
- stage A is retrieval-only on all 16 development cases. If treatment does not
  increase gold-session endpoint coverage without a coverage regression, stop
  before any answer or judge call; a passing stage A authorizes only the frozen
  protection replays, not paired answer conversion;
- stage A reports evidence-session coverage, added facts/tokens, query calls,
  selected endpoint coverage, and noise separately. Only a later authorized
  answer stage may report answer net wins;
- run only on development plus frozen LoCoMo multi-hop and BEAM multi-session
  protection slices. A non-positive LongMemEval development net win, any
  protection answer regression, or unbounded cost rejects the mechanism;
- ordinary non-temporal `A or B` questions, `how many items` counts, and
  ordinary non-temporal single-fact lookups are negative controls and must not
  gain supplementary recalls;
- the existing assembly holdout is not reusable for this new mechanism. A new
  disjoint holdout may be selected only after positive development and
  protection evidence.

Before any treatment was run, a non-canonical control-only diagnostic exposed
one necessary protocol revision. The English analyzer identity correctly moved
from 12 to 13 for the new query semantics, so the provenance-bearing raw recall
snapshot cannot equal the clean v2 snapshot. Across all 16 controls, the
current runtime still matched the clean v2 context hash, token count, and
recall-union session list exactly, while 0/16 raw snapshots matched. A second
non-canonical control-only isolation diagnostic using the same current code
with only the analyzer identity reset to 12 matched all four fields, including
the raw snapshot, on 16/16. This establishes that the observed snapshot drift
is the required analyzer migration identity, not a context or retrieval
change. Neither diagnostic constructed treatment or called an answerer or
judge; neither is promotion evidence.

The Stage A v2 runner therefore rebuilds all 16 controls in selection order and
requires exact per-case clean-v2 surface identity: context hash, token count,
and recall-union session list. It records both current and legacy raw snapshot
hashes and their match status, but does not misuse a versioned provenance hash
as a cross-analyzer behavior oracle. Treatment is not constructed if any
surface field differs. For every question where the grammar emits no temporal
operand, the rebuilt treatment must also be fully identical to the current
control, including context, snapshot, recall union, reader-visible attribution,
query count, and record count; otherwise the entire run fails before a gate can
pass. This prevents counter drift or an ordinary-query change from being
credited to temporal decomposition.

The runner reports final reader-visible endpoint coverage separately from the
broader recall union, plus added/lost gold endpoints, non-gold-visible sessions
as a noise proxy, record/token deltas, and actual recall passes from runtime
traces. It has no answer, judge, or holdout entry point. Reader-visible
attribution uses a source-prefix match only when that prefix cannot also be
found inside another session's source turn; an ambiguous match fails closed.
Dependency-injected test runs are marked non-canonical and cannot open the
retrieval gate. Even a canonical passing Stage A cannot authorize answer
conversion until the pre-registered protection replays also pass.

This tests the transferable S2G-RAG gap contract and LongMemEval's time-aware
query-expansion lesson with deterministic slots. It does not import a trained
controller, gold-support supervision, or benchmark-specific prompt literals.

#### Canonical Stage A result and protection freeze

Canonical Stage A ran from clean commit
`4077d7beb8db1d15ffd73fd10f7d0d9bc55e55d0` under Bun 1.3.14. Reader-visible
gold-session coverage increased from 24 to 28 endpoints: four endpoints were
added, none were lost, four of 16 cases improved, and none regressed. Seven
questions activated temporal operands; all nine non-trigger questions were
exactly unchanged. This is a positive retrieval mechanism result, not an
answer result.

The treatment raised query calls from 16 to 26, recall records from 297 to 402,
and rendered context from 36,721 to 38,314 estimated tokens. On the seven
triggered questions alone, context rose 16,764 to 18,357 (+9.50%) and records
rose 126 to 231 (+83.33%). It added four gross non-gold visible endpoints and
removed seven while adding four gold endpoints. Artifact:
`reports/eval/research/phase-72/longmemeval-temporal-operands/run-phase72-longmemeval-temporal-operands-development-stage-a-bun1314-v1/report.json`,
SHA-256
`57118fae09d53984da90998ab073fc939eb5dd20d922f9673829464d52a14219`.
The report keeps `answerConversionAuthorized=false`; it made no answer, judge,
or holdout call.

The next retrieval-only protection population is frozen in
`scripts/eval-profiles/phase-72/temporal-operands-protection-v1.json`, SHA-256
`41ea410c7623dfa24315d7853386900deaeb93f3feff95210f8e34fe5fd403e4`.
It selects complete categories rather than score-picked questions:

- LoCoMo: all 321 `temporal` activation questions plus all 282 `multi_hop`
  designated negative controls across 10 conversations; seven questions
  activate operands.
- BEAM 100K: all 40 `temporal_reasoning` activation questions plus all 40
  `multi_session_reasoning` designated negative controls across 20
  conversations; 30 questions activate operands.

The resulting 683-question matrix has 37 treatments and 646 exact no-trigger
controls, including 322 designated cross-session controls. Every question and
arm receives a freshly seeded memory, so extra operand recalls cannot warm the
next question through access telemetry. LoCoMo and BEAM must each independently
retain every previously covered gold endpoint, keep gross added noise per added
gold endpoint at or below 1, keep triggered context growth at or below 15%,
keep triggered recall-record growth at or below 100%, and stay within three
queries per question. These are development-adaptive ceilings derived from
Stage A and frozen before protection retrieval; they are not independent SLOs
or confirmatory guardrails.

At this freeze point no LoCoMo or BEAM protection retrieval has run. The runner
requires Bun 1.3.14 and a clean commit, executes all controls before treatments,
uses label-free raw ingest with rules-only in-memory retrieval, and has no
answer, judge, or holdout entry point. A passing result can establish only a
cross-benchmark retrieval protection gate and authorize a separately frozen
paired answer-protection step. It cannot establish score improvement,
independent generalization, default enablement, holdout readiness, or a public
benchmark claim.

## 8. Primary sources

Benchmarks/ablations: LongMemEval arXiv 2410.10813 · LoCoMo audit
(penfieldlabs, LoCoMo-Refined github.com/mem-eval-suite/LoCoMo_refined) · BEAM
arXiv 2510.27246 · MemoryAgentBench arXiv 2507.05257 · ImplicitMemBench arXiv
2604.08064. Mechanisms: deterministic freshness arXiv 2606.01435 · control-plane
placement arXiv 2606.15903 · Zep/Graphiti arXiv 2501.13956 · HippoRAG2 arXiv
2502.14802 · SeCom arXiv 2502.05589 · Nemori arXiv 2508.03341 · TriMem arXiv
2605.19952 · Hindsight arXiv 2512.12818 · Chain-of-Note arXiv 2311.09210 ·
IRCoT ACL 2023 · docTTTTTquery (castorini) · sleep-time compute arXiv
2504.13171 · LightMem arXiv 2510.18866 · RMM arXiv 2503.08026 · Memory-R1
arXiv 2508.19828 · SAGE arXiv 2605.30711 · Supersede arXiv 2606.27472 ·
MemReranker arXiv 2605.06132 · MemDelta arXiv 2606.29914 · Mastra OM
(mastra.ai/research/observational-memory) · vendor claims individually marked.
Claude Code patterns: `third-party/claude-code-main/src/memdir/`,
`src/services/{extractMemories,autoDream,compact,SessionMemory}/`.
