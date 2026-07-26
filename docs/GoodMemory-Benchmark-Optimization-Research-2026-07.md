# GoodMemory Benchmark Optimization — Research Synthesis and Plan

Date: 2026-07-20. Status: research input plus a first implementation pass (see
the implementation log at the end). No scores below are new evidence; no
benchmark measurement has been run against the implemented changes yet. Sources: full repo exploration
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
| LongMemEval (internal) | strict 0.720 / gpt-5.5 rescore 0.924 | temporal-reasoning (recall 0.767 after Phase 69; acc 0.842), preference 0.800, multi-session | Of 119 wrong at 0.720-era analysis, **64 had full recall** → residual is **answer-side**; largest bucket `missedRecall|multi-session|noAnswer` |
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
  Hindsight 91.4 (paper). GoodMemory's 0.924 diagnostic sits in the honest
  competitive band; the 0.720 judge-free floor has no published analogue (most
  systems report judged-only).
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

Honest expected ranges if A–E land (not commitments): LongMemEval judged
0.924 → 0.93–0.95, strict 0.720 → 0.75–0.78; LoCoMo official 0.8708 →
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
  condition. **R9.4** built (claim-slot sweep in the contradiction job);
  the R9 observation-synthesis jobs remain unstarted. **R11** increment 1
  built (coverage line); full calibration unstarted. **R8 / R10 / R12**
  unstarted Stage E/F builds — untouched by this pass and explicitly out
  of its scope; they are the remaining open build queue now that the R6
  production-stack question is settled.

Verification at close: unit+integration sweep 5105 pass / typecheck clean
(the only failure is a parallel workstream's uncommitted in-flight file,
`codex-coding-effect.c6-package-closure-materializer-cli.test.ts`).

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
