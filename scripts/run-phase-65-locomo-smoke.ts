// Phase 65 LoCoMo smoke adapter + retrieval-focused smoke report.
//
// This runner ingests normalized LoCoMo cases into a fresh GoodMemory instance
// (the multi-session conversation), recalls per question, and reports
// retrieval-quality metrics per QA category: evidence-turn recall, noise, and
// (for multi-hop) cross-session chain completeness. It mirrors the Phase 63 BEAM
// and Phase 64 MemoryAgentBench recall-diagnostic seams: deterministic in-memory
// storage, every dialog turn preserved as a retrievable fact, and rules-only
// recall.
//
// By default it runs the synthetic smoke fixtures from src/eval/locomo (no
// upstream data is vendored — LoCoMo is CC BY-NC 4.0, non-commercial). When
// --benchmark-root / GOODMEMORY_LOCOMO_ROOT is provided it reads prepared,
// already-normalized cases from <root>/cases.json, establishing the external-root
// convention without copying upstream files into the repo.
//
// Answer / task accuracy is intentionally NOT scored by default: the
// deterministic smoke slice is retrieval-only, and true answer accuracy needs a
// live LLM generator (a later live mode). The report still carries an
// `answerAccuracy` field per category, set to null, so the contract is complete
// and the deferral is explicit rather than silent.

import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInternalGoodMemory } from "../src/api/createGoodMemory";
import {
  RECOMMENDED_GENERALIZED_FUSION_MAX_CANDIDATES,
  RECOMMENDED_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
  RECOMMENDED_RERANK_GENERALIZED_FUSION_MAX_CANDIDATES,
  RECOMMENDED_RERANK_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
} from "../src/api/retrievalPreset";
import type {
  GoodMemory,
  GoodMemoryConfig,
  GoodMemoryEmbeddingProviderConfig,
  GoodMemoryRerankingProviderConfig,
  RecallResult,
} from "../src/api/contracts";
import { inspectGoodMemoryRuntime } from "../src/api/runtimeInfo";
import { createProviderRetrievalCueGenerator } from "../src/provider/retrievalCueGenerator";
import type { EmbeddingAdapter } from "../src/embedding/contracts";
import { createLexicalCoverageReranker } from "../src/recall/reranker";
import {
  DEFAULT_GENERALIZED_FUSION_MIN_RELATIVE_STRENGTH,
  DEFAULT_GENERALIZED_FUSION_RRF_K,
} from "../src/recall/generalizedFusion";
import {
  buildLocomoSmokeCases,
  locomoTokenF1,
  LOCOMO_QA_CATEGORIES,
  parseLocomoSession,
  scoreLocomoAnswer,
  type LocomoCase,
  type LocomoQaCategory,
  type LocomoQuestion,
  type LocomoTurn,
} from "../src/eval/locomo";
import {
  hasCliFlagStrict,
  resolveCliFlagValueStrict,
  resolveCliPathSegmentFlagValueStrict,
  resolveEnvValueStrict,
} from "./cli-options";
import { LOCOMO_REANSWER_JOB_BUCKET_SET } from "./locomo-reanswer-contracts";
import { resolveRepoRootFromScriptUrl } from "./script-paths";
import {
  requestOpenAICompatibleText,
  stripThinkingBlocks,
  withAISDKRetries,
} from "../src/provider/ai-sdk-runtime";
import {
  resolveLiveModelConfig,
  resolveProviderBackedModelConfig,
} from "./run-eval";
import { buildAnswerEvidencePack } from "../src/eval/protocol-reader/evidencePack";
import type { EvidenceTurn } from "../src/eval/protocol-reader/evidencePack";
import {
  createProviderConversationalMemoryExtractor,
  createProviderEmbeddingAdapter,
} from "../src/provider/layer";
import type { MemoryExtractor } from "../src/remember/candidates";

export const LOCOMO_SMOKE_RUN_ID = "run-phase65-locomo-smoke-current";
export const LOCOMO_SMOKE_REPORT_FILE_NAME = "smoke-report.json";
// Per-question checkpoint (one completed LocomoQuestionRetrieval JSON per line),
// mirroring the Phase 63/64 resumable-run pattern: long live runs survive
// gateway outages by re-running with --resume, which replays completed
// questions from this file instead of recomputing them.
export const LOCOMO_LIVE_PROGRESS_FILE_NAME = "live-progress.jsonl";
// Session-level conversational-extraction cache (content-addressed): extraction
// is the expensive, model-backed half of a conversational-ingest run and does
// not depend on recall-side flags, so re-runs of the same runId reuse it even
// without --resume.
export const LOCOMO_EXTRACTION_CACHE_FILE_NAME = "extraction-cache.jsonl";
export const LOCOMO_ROOT_ENV = "GOODMEMORY_LOCOMO_ROOT";
export const LOCOMO_PROVIDER_EMBEDDING_TIMEOUT_MS_ENV =
  "GOODMEMORY_LOCOMO_PROVIDER_EMBEDDING_TIMEOUT_MS";
export const LOCOMO_PROVIDER_EMBEDDING_RUN_TIMEOUT_MS_ENV =
  "GOODMEMORY_LOCOMO_PROVIDER_EMBEDDING_RUN_TIMEOUT_MS";
const LOCOMO_PROGRESS_CONFIG_KIND = "locomo-progress-config";
const GENERATED_BY = "scripts/run-phase-65-locomo-smoke.ts";
const EXTERNAL_CASES_FILE_NAME = "cases.json";
const UPSTREAM_SOURCE = "https://github.com/snap-research/locomo";
const UPSTREAM_LICENSE = "CC BY-NC 4.0";
const LOCOMO_QA_CATEGORY_SET: ReadonlySet<string> = new Set(
  LOCOMO_QA_CATEGORIES,
);
const LOCOMO_REPAIR_JOB_DIAGNOSES = [
  "balanced-partial-overlap",
  "numeric-or-frequency-format",
  "over-specified-answer",
  "rationale-bearing-gold-answer",
  "under-specified-answer",
  "zero-token-overlap",
] as const;
type LocomoRepairJobDiagnosis = (typeof LOCOMO_REPAIR_JOB_DIAGNOSES)[number];
const LOCOMO_REPAIR_JOB_DIAGNOSIS_SET: ReadonlySet<string> = new Set(
  LOCOMO_REPAIR_JOB_DIAGNOSES,
);
const LOCOMO_REPAIR_JOB_RETRIEVAL_BUCKETS = [
  "full",
  "partial",
  "zero",
] as const;
type LocomoRepairJobRetrievalBucket =
  (typeof LOCOMO_REPAIR_JOB_RETRIEVAL_BUCKETS)[number];
const LOCOMO_REPAIR_JOB_RETRIEVAL_BUCKET_SET: ReadonlySet<string> = new Set(
  LOCOMO_REPAIR_JOB_RETRIEVAL_BUCKETS,
);

function isLocomoRepairJobDiagnosis(
  value: unknown,
): value is LocomoRepairJobDiagnosis {
  return (
    typeof value === "string" && LOCOMO_REPAIR_JOB_DIAGNOSIS_SET.has(value)
  );
}

function isLocomoRepairJobRetrievalBucket(
  value: unknown,
): value is LocomoRepairJobRetrievalBucket {
  return (
    typeof value === "string" &&
    LOCOMO_REPAIR_JOB_RETRIEVAL_BUCKET_SET.has(value)
  );
}

// The smoke slice exercises GoodMemory's rules-only retrieval path only; a live
// generator profile is added later.
const PROFILES_COMPARED = ["goodmemory-rules-only"] as const;

export interface LocomoSmokeCliOptions {
  // Opt-in live-answer policy probe: LoCoMo open-domain questions sometimes
  // require resolving common world facts from dialog evidence (for example a
  // city -> state). Defaults off so direct-recall and adversarial/no-answer
  // behavior stay conservative unless a run explicitly tests this answer policy.
  allowCommonsenseResolution?: boolean;
  // Opt-in live-answer policy probe: for adversarial/no-answer questions, require
  // a directly supported relationship in the retrieved dialog before producing a
  // concrete answer. Defaults off so historical live reports remain comparable.
  strictNoEvidenceAbstention?: boolean;
  benchmarkRoot?: string;
  caseIds?: string[];
  questionIds?: string[];
  questionIdFile?: string;
  questionCategories?: LocomoQaCategory[];
  repairJobDiagnoses?: LocomoRepairJobDiagnosis[];
  repairJobRetrievalBuckets?: LocomoRepairJobRetrievalBucket[];
  // Opt-in: rank retrieval with the Okapi BM25 lexical leg (recall under the
  // "hybrid" strategy) instead of the default naive Jaccard rules-only floor.
  // Deterministic and embedding-free, so it needs no model gateway.
  bm25?: boolean;
  // Opt-in Phase 69 generalized projection retrieval (multi-granular BM25 +
  // direct entity adjacency, plus dense only when a real provider is present).
  generalizedFusion?: boolean;
  // Optional dynamic-budget floor sweep knob (requires --generalized-fusion):
  // threads retrieval.generalizedFusionMinRelativeStrength through the
  // recommended preset. Absent = preset default (engine floor 0, no trimming).
  fusionMinRelativeStrength?: number;
  // R7 opt-in (requires --generalized-fusion): entity PageRank channel via
  // retrieval.generalizedFusionEntityPageRank.
  entityPageRank?: boolean;
  // Opt-in R6 write-time question expansion: after seeding each case, backfill
  // attributes.retrievalCues on every stored fact through the shipped
  // retrievalCues maintenance job (generation is prefetched concurrently, the
  // writes replay through the job so stored bytes match the product path).
  retrievalCues?: boolean;
  // Phase 69 protocol: preserve raw turns uniformly without benchmark-only
  // category or answer-label metadata.
  labelFreeIngest?: boolean;
  // Opt-in deterministic speaker-coreference normalization at seed time
  // (first/second-person pronouns -> participant names). Gateway-free; bridges
  // the coreference half of the phrasing gap without an LLM.
  corefNormalize?: boolean;
  // Opt-in deterministic query decomposition (Move 3). Gateway-free.
  decompose?: boolean;
  // Opt-in N-hop iterative recall (Move 6); true = 2 passes. Gateway-free
  // (lexical bridge entities).
  multiHop?: boolean;
  // Opt-in gateway-free lexical-coverage reranker over the top-K (Move 5).
  rerank?: boolean;
  // Opt-in provider-backed embedding resolution via GOODMEMORY_EMBEDDING_* (or
  // an injected provider config in tests). Without this flag, semantic-candidate
  // smoke runs intentionally use the deterministic smoke embedding adapter and
  // remain plumbing proof only.
  providerEmbedding?: boolean;
  // Optional request timeout for provider-backed embedding calls. Defaults to the
  // shared provider timeout when omitted; the CLI env override is only honored
  // when --provider-embedding is active so deterministic smokes stay isolated.
  providerEmbeddingTimeoutMs?: number;
  // Optional whole-run watchdog for provider-backed retrieval-only experiments.
  // This is separate from the per-request timeout because LoCoMo seeding can
  // involve many bounded embedding calls before the command prints a report.
  providerEmbeddingRunTimeoutMs?: number;
  // Opt-in first-party provider reranking through GOODMEMORY_EVAL_*.
  // With generalized fusion this selects the production recommended listwise
  // lane; it is distinct from the gateway-free --rerank probe above.
  providerReranking?: boolean;
  providerRerankingTimeoutMs?: number;
  // Opt-in semantic candidate-generation union: force-admit vector top-K facts
  // into selection under hybrid recall. This is benchmark-probe plumbing only;
  // the result is meaningful only when the embedding source is meaningful.
  semanticCandidates?: boolean;
  semanticCandidateMaxAdditions?: number;
  semanticCandidateMinRelativeScore?: number;
  semanticCandidateMinSimilarity?: number;
  semanticCandidateTopK?: number;
  // Opt-in (live-answer only): build the answer context from the records recall
  // actually surfaced (normalized facts included) instead of reconstructing raw
  // turns, mirroring the product buildContext path. Targets the answer-assembly
  // bottleneck on conversational corpora.
  answerFromRecalled?: boolean;
  // Opt-in live-answer mode: score and answer from the facts that fit in the
  // rendered MemoryPacket, after reranking, rather than every selected fact.
  answerFromPacket?: boolean;
  // Opt-in: seed memory with LLM conversational atomic-fact extraction instead of
  // raw dialogue turns (improvement-plan #3). Requires GOODMEMORY_EVAL_* model env.
  conversationalExtraction?: boolean;
  evidencePack?: boolean;
  // Opt-in (with --conversational-extraction): drop facts that merely echo their
  // raw turn so only genuinely-normalized facts augment storage, reducing the
  // candidate-pool dilution measured on non-phrasing-gap categories.
  smartFusion?: boolean;
  // Parallel question recalls within one seeded conversation. Defaults to 1.
  concurrency?: number;
  limit?: number;
  live?: boolean;
  // Opt-in: resume a previous run of the same runId from its per-question
  // checkpoint (live-progress.jsonl). Completed questions are replayed from the
  // checkpoint; a case whose questions are all checkpointed skips seeding (and
  // therefore extraction) entirely.
  resume?: boolean;
  outputDir?: string;
  runId?: string;
}

function semanticCandidateTuningFlagWithoutAdmission(
  options: Pick<
    LocomoSmokeCliOptions,
    | "semanticCandidateMaxAdditions"
    | "semanticCandidateMinRelativeScore"
    | "semanticCandidateMinSimilarity"
    | "semanticCandidates"
    | "semanticCandidateTopK"
  >,
): string | null {
  if (options.semanticCandidates === true) {
    return null;
  }
  if (options.semanticCandidateTopK !== undefined) {
    return "--semantic-candidate-top-k";
  }
  if (options.semanticCandidateMaxAdditions !== undefined) {
    return "--semantic-candidate-max-additions";
  }
  if (options.semanticCandidateMinSimilarity !== undefined) {
    return "--semantic-candidate-min-similarity";
  }
  if (options.semanticCandidateMinRelativeScore !== undefined) {
    return "--semantic-candidate-min-relative-score";
  }
  return null;
}

function assertSemanticCandidateTuningRequiresAdmission(
  options: Pick<
    LocomoSmokeCliOptions,
    | "semanticCandidateMaxAdditions"
    | "semanticCandidateMinRelativeScore"
    | "semanticCandidateMinSimilarity"
    | "semanticCandidates"
    | "semanticCandidateTopK"
  >,
): void {
  const flagName = semanticCandidateTuningFlagWithoutAdmission(options);
  if (flagName === null) {
    return;
  }
  throw new Error(`${flagName} requires --semantic-candidates.`);
}

function assertProviderEmbeddingTimeoutsRequireProvider(
  options: Pick<
    LocomoSmokeCliOptions,
    | "providerEmbedding"
    | "providerEmbeddingRunTimeoutMs"
    | "providerEmbeddingTimeoutMs"
  >,
): void {
  if (options.providerEmbedding === true) {
    return;
  }
  if (options.providerEmbeddingTimeoutMs !== undefined) {
    throw new Error(
      "--provider-embedding-timeout-ms requires --provider-embedding.",
    );
  }
  if (options.providerEmbeddingRunTimeoutMs !== undefined) {
    throw new Error(
      "--provider-embedding-run-timeout-ms requires --provider-embedding.",
    );
  }
}

function assertProviderRerankingTimeoutRequiresProvider(
  options: Pick<
    LocomoSmokeCliOptions,
    "providerReranking" | "providerRerankingTimeoutMs"
  >,
): void {
  if (
    options.providerReranking !== true &&
    options.providerRerankingTimeoutMs !== undefined
  ) {
    throw new Error(
      "--provider-reranking-timeout-ms requires --provider-reranking.",
    );
  }
}

function answerPolicyFlagWithoutLive(
  options: Pick<
    LocomoSmokeCliOptions,
    "allowCommonsenseResolution" | "live" | "strictNoEvidenceAbstention"
  >,
): string | null {
  if (options.live === true) {
    return null;
  }
  if (options.allowCommonsenseResolution === true) {
    return "--allow-commonsense-resolution";
  }
  if (options.strictNoEvidenceAbstention === true) {
    return "--strict-no-evidence-abstention";
  }
  return null;
}

function assertAnswerPolicyFlagsRequireLive(
  options: Pick<
    LocomoSmokeCliOptions,
    "allowCommonsenseResolution" | "live" | "strictNoEvidenceAbstention"
  >,
): void {
  const flagName = answerPolicyFlagWithoutLive(options);
  if (flagName === null) {
    return;
  }
  throw new Error(`${flagName} requires --live.`);
}

function answerContextFlagWithoutLive(
  options: Pick<
    LocomoSmokeCliOptions,
    "answerFromPacket" | "answerFromRecalled" | "evidencePack" | "live"
  >,
): string | null {
  if (options.live === true) {
    return null;
  }
  if (options.answerFromRecalled === true) {
    return "--answer-from-recalled";
  }
  if (options.answerFromPacket === true) {
    return "--answer-from-packet";
  }
  if (options.evidencePack === true) {
    return "--evidence-pack";
  }
  return null;
}

function assertAnswerContextFlagsRequireLive(
  options: Pick<
    LocomoSmokeCliOptions,
    "answerFromPacket" | "answerFromRecalled" | "evidencePack" | "live"
  >,
): void {
  const flagName = answerContextFlagWithoutLive(options);
  if (flagName === null) {
    return;
  }
  throw new Error(`${flagName} requires --live.`);
}

// Live-answer seam (mirrors the BEAM live-slice / Phase 64 generator). Given the
// retrieved context, produce a candidate answer. Correctness is then scored
// DETERMINISTICALLY by the upstream match mode (token-F1 / adversarial
// abstention) via scoreLocomoAnswer, so no LLM judge is needed. Wiring a real
// model is deferred ("later"); supplying a generator flips the run into
// "live-answer" mode, otherwise the run stays retrieval-only.
export interface LocomoAnswerGeneratorInput {
  memoryContext: string;
  question: LocomoQuestion;
  retrievedTurnIds: readonly string[];
  testCase: LocomoCase;
}

export type LocomoAnswerGenerator = (
  input: LocomoAnswerGeneratorInput,
) => Promise<string>;

export interface LocomoSmokeDependencies {
  answerGenerator?: LocomoAnswerGenerator;
  appendFile?: (path: string, data: string) => Promise<void>;
  // Injected conversational extractor (tests pass a deterministic mock; live
  // runs resolve the configured GOODMEMORY_EVAL_* model).
  conversationalExtractor?: MemoryExtractor;
  // Injected retrieval-cue generator for --retrieval-cues (tests pass a
  // deterministic stub; live runs resolve the configured GOODMEMORY_EVAL_*
  // model through createProviderRetrievalCueGenerator).
  retrievalCueGenerator?: {
    generate(input: {
      category: string;
      content: string;
      subject?: string;
    }): Promise<string[]>;
  };
  createMemory?: () => GoodMemory;
  mkdir?: typeof mkdir;
  now?: () => Date;
  nowMs?: () => number;
  readFile?: (path: string) => Promise<string>;
  writeFile?: typeof writeFile;
}

class LocomoProviderEmbeddingRunTimeoutError extends Error {
  constructor(timeoutMs: number, stage: string) {
    super(
      `LoCoMo provider embedding run timeout after ${timeoutMs}ms while ${stage}.`,
    );
    this.name = "LocomoProviderEmbeddingRunTimeoutError";
  }
}

interface LocomoProviderEmbeddingRunDeadline {
  deadlineMs: number;
  timeoutMs: number;
}

export type LocomoExecutionFailureStage =
  | "answer"
  | "provider-run-timeout"
  | "recall"
  | "seed";

// Per-question result. Retrieval fields are always populated; answer fields are
// null unless a live-answer generator is supplied.
export interface LocomoQuestionRetrieval {
  // null in retrieval-only mode; true/false once an answer is generated and
  // scored by the upstream match mode.
  answerCorrect: boolean | null;
  // Raw token-F1 between the generated answer and gold answer. Older reports may
  // omit this field; new retrieval-only and failed live rows write null.
  answerTokenF1?: number | null;
  caseId: string;
  category: LocomoQaCategory;
  evidenceRecall: number;
  evidenceTurnIds: string[];
  executionFailureMessage?: string | null;
  executionFailureStage?: LocomoExecutionFailureStage | null;
  generatedAnswer: string | null;
  goldEvidenceFullyRetrieved: boolean;
  missingEvidenceTurnIds: string[];
  noiseTurnCount: number;
  noiseTurnIds: string[];
  questionId: string;
  retrievedTurnIds: string[];
}

export interface LocomoCategoryRetrievalSummary {
  // null in retrieval-only mode; the deterministic answer accuracy (correct /
  // answered) once a live-answer generator is supplied.
  answerAccuracy: number | null;
  answeredCount: number;
  averageEvidenceRecall: number;
  category: LocomoQaCategory;
  // Non-null only for multi_hop: were ALL evidence turns retrieved for every
  // multi-hop question (the necessary condition for cross-session composition).
  // Null for categories where the concept does not apply.
  crossSessionChainReady: boolean | null;
  fullyRetrievedCount: number;
  noiseTurnTotal: number;
  questionCount: number;
}

export type LocomoAnswerContextMode =
  | "evidence-pack"
  | "gold-evidence-only-pack"
  | "packet-evidence-pack"
  | "raw-turns"
  | "recalled-records";

export interface LocomoSmokeReport {
  allowCommonsenseResolution?: boolean;
  strictNoEvidenceAbstention?: boolean;
  answerAccuracyOverall?: number | null;
  answerAttempts?: number;
  answerContextMode?: LocomoAnswerContextMode;
  answerEvidenceTurnLimit?: number | null;
  answerEvaluation: "deferred-to-live-mode" | "scored";
  answerSystem?: string | null;
  answerTimeoutMs?: number | null;
  // Chain-of-note reading mode: the evidence pack carries a per-entry note
  // protocol and only the extracted final answer is scored.
  chainOfNote?: boolean;
  benchmark: "locomo";
  // Resolved case source: "synthetic-smoke" or the external cases.json path.
  benchmarkSource: string;
  benchmarkFingerprint?: string;
  // Whether the Okapi BM25 lexical leg (hybrid strategy) ranked retrieval, vs
  // the default naive-Jaccard rules-only floor.
  bm25Ranking: boolean;
  generalizedFusion?: boolean;
  generalizedFusionConfig?: {
    entityPageRank?: boolean;
    maxCandidates: number;
    maxTotalFacts: number;
    minRelativeStrength: number;
    rrfK: number;
  } | null;
  // R6 write-time question expansion: present exactly when --retrieval-cues
  // ran; factsSeen counts facts offered to the generator, cuesApplied counts
  // facts whose cues were written through the maintenance job.
  retrievalCues?: { cuesApplied: number; factsSeen: number };
  labelFreeIngest?: boolean;
  // Selected case ids after --case-id filtering, in source order.
  caseIds: string[];
  caseCount: number;
  cases: LocomoQuestionRetrieval[];
  categories: LocomoCategoryRetrievalSummary[];
  concurrency?: number;
  evidenceRecallOverall?: number;
  executionFailures: number;
  // External root supplied by the caller, or null for the synthetic default.
  externalRoot: string | null;
  generatedAt: string;
  generatedBy: string;
  // How memory was seeded: raw dialogue turns only, or raw turns PLUS additive
  // LLM conversational atomic-fact extraction (improvement-plan #3, opt-in via
  // --conversational-extraction). The conversational mode is never destructive:
  // normalized facts augment the raw turns, they do not replace them.
  ingestMode: "raw-turns" | "conversational-extraction";
  license: string;
  mode: "retrieval-only" | "live-answer";
  phase: "phase-65";
  profilesCompared: string[];
  providerEmbeddingRunTimeoutMs?: number | null;
  providerEmbeddingTimeoutMs?: number | null;
  providerReranking?: boolean;
  providerRerankingTimeoutMs?: number | null;
  questionCount: number;
  // Selected question categories after --category filtering, or null when all
  // LoCoMo categories are included.
  questionCategories: LocomoQaCategory[] | null;
  questionIds?: string[] | null;
  // Present on targeted smoke/live runs: the explicit ids, manifest, and
  // optional repair-job filters that selected the questionIds header.
  questionSelection?: {
    explicitQuestionIds: string[] | null;
    questionIdFile: string | null;
    repairJobDiagnoses: string[] | null;
    repairJobRetrievalBuckets: string[] | null;
  };
  // Present on report-level reanswer runs: the manifest and optional job-bucket
  // filter that selected the replayed rows.
  reanswerSelection?: {
    explicitQuestionIds: string[] | null;
    questionIdFile: string | null;
    reanswerJobBuckets: string[] | null;
    reanswerJobCategories: LocomoQaCategory[] | null;
  };
  // Whether this report was assembled with --resume (some results replayed from
  // the per-question checkpoint rather than recomputed).
  resume: boolean;
  retrievalConfig?: {
    bm25Ranking: boolean;
    corefNormalize: boolean;
    decompose: boolean;
    generalizedFusion: boolean;
    labelFreeIngest: boolean;
    multiHop: boolean;
    providerEmbedding: boolean;
    providerReranking?: boolean;
    rerank: boolean;
    smartFusion: boolean;
  };
  rerankGeneralizedFusionConfig?: {
    maxCandidates: number;
    maxTotalFacts: number;
  } | null;
  runDirectory: string;
  runId: string;
  semanticCandidateEmbeddingSource: "none" | "provider" | "smoke-hash";
  semanticCandidates: {
    enabled: boolean;
    maxAdditions: number | null;
    minRelativeScore: number | null;
    minSimilarity: number | null;
    topK: number | null;
  };
  // Present on report-level reanswer runs that reuse retrieved turns from a
  // previous report instead of rerunning retrieval.
  sourceReport?: {
    answerContextMode: LocomoAnswerContextMode | null;
    generatedAt: string;
    path: string;
    retrievalConfig: {
      bm25Ranking: boolean;
      semanticCandidateEmbeddingSource: "none" | "provider" | "smoke-hash";
      semanticCandidates: {
        enabled: boolean;
        maxAdditions: number | null;
        minRelativeScore: number | null;
        minSimilarity: number | null;
        topK: number | null;
      };
    };
    runId: string;
  };
  // The answer/task metric upstream scores each category with, surfaced so a
  // later live mode applies the matching deterministic check.
  upstreamAnswerMetricByCategory: Partial<Record<LocomoQaCategory, string>>;
  upstreamSource: string;
}

export function parseLocomoSmokeCliOptions(
  argv: readonly string[],
): LocomoSmokeCliOptions {
  const limit = parsePositiveIntegerFlag(argv, "--limit");
  const providerEmbedding = hasCliFlagStrict(argv, "--provider-embedding");
  const providerEmbeddingTimeoutMs =
    parsePositiveIntegerFlag(argv, "--provider-embedding-timeout-ms") ??
    (providerEmbedding
      ? parsePositiveIntegerEnv(LOCOMO_PROVIDER_EMBEDDING_TIMEOUT_MS_ENV)
      : undefined);
  const providerEmbeddingRunTimeoutMs =
    parsePositiveIntegerFlag(argv, "--provider-embedding-run-timeout-ms") ??
    (providerEmbedding
      ? parsePositiveIntegerEnv(
          LOCOMO_PROVIDER_EMBEDDING_RUN_TIMEOUT_MS_ENV,
        )
      : undefined);
  const providerReranking = hasCliFlagStrict(argv, "--provider-reranking");
  const providerRerankingTimeoutMs = parsePositiveIntegerFlag(
    argv,
    "--provider-reranking-timeout-ms",
  );
  const semanticCandidateTopK = parsePositiveIntegerFlag(
    argv,
    "--semantic-candidate-top-k",
  );
  const semanticCandidateMaxAdditions = parseNonNegativeIntegerFlag(
    argv,
    "--semantic-candidate-max-additions",
  );
  const semanticCandidateMinSimilarity = parseNonNegativeNumberFlag(
    argv,
    "--semantic-candidate-min-similarity",
  );
  const semanticCandidateMinRelativeScore = parseUnitIntervalFlag(
    argv,
    "--semantic-candidate-min-relative-score",
  );
  const fusionMinRelativeStrength = parseUnitIntervalFlag(
    argv,
    "--fusion-min-relative-strength",
  );
  if (
    fusionMinRelativeStrength !== undefined &&
    !hasCliFlagStrict(argv, "--generalized-fusion")
  ) {
    throw new Error(
      "--fusion-min-relative-strength requires --generalized-fusion",
    );
  }
  const entityPageRank = hasCliFlagStrict(argv, "--entity-page-rank");
  if (entityPageRank && !hasCliFlagStrict(argv, "--generalized-fusion")) {
    throw new Error("--entity-page-rank requires --generalized-fusion");
  }
  const parsed = {
    benchmarkRoot:
      resolveCliFlagValueStrict(argv, "--benchmark-root") ??
      resolveEnvValueStrict(process.env, LOCOMO_ROOT_ENV),
    allowCommonsenseResolution: hasCliFlagStrict(
      argv,
      "--allow-commonsense-resolution",
    ),
    strictNoEvidenceAbstention: hasCliFlagStrict(
      argv,
      "--strict-no-evidence-abstention",
    ),
    answerFromPacket: hasCliFlagStrict(argv, "--answer-from-packet"),
    answerFromRecalled: hasCliFlagStrict(argv, "--answer-from-recalled"),
    bm25: hasCliFlagStrict(argv, "--bm25"),
    generalizedFusion: hasCliFlagStrict(argv, "--generalized-fusion"),
    fusionMinRelativeStrength,
    entityPageRank,
    retrievalCues: hasCliFlagStrict(argv, "--retrieval-cues"),
    labelFreeIngest: hasCliFlagStrict(argv, "--label-free-ingest"),
    caseIds: parseUniqueStringListFlag(argv, "--case-id"),
    questionIdFile: resolveCliFlagValueStrict(argv, "--question-id-file"),
    questionIds: parseStringListFlag(argv, "--question-id"),
    questionCategories: parseLocomoCategoryListFlag(argv, "--category"),
    repairJobDiagnoses: parseLocomoRepairJobDiagnosisListFlag(
      argv,
      "--repair-job-diagnosis",
    ),
    repairJobRetrievalBuckets: parseLocomoRepairJobRetrievalBucketListFlag(
      argv,
      "--repair-job-retrieval-bucket",
    ),
    conversationalExtraction: hasCliFlagStrict(
      argv,
      "--conversational-extraction",
    ),
    concurrency: parsePositiveIntegerFlag(argv, "--concurrency"),
    corefNormalize: hasCliFlagStrict(argv, "--coref-normalize"),
    decompose: hasCliFlagStrict(argv, "--decompose"),
    evidencePack: hasCliFlagStrict(argv, "--evidence-pack"),
    multiHop: hasCliFlagStrict(argv, "--multihop"),
    providerEmbedding,
    providerEmbeddingRunTimeoutMs,
    providerEmbeddingTimeoutMs,
    providerReranking,
    providerRerankingTimeoutMs,
    rerank: hasCliFlagStrict(argv, "--rerank"),
    semanticCandidateMaxAdditions,
    semanticCandidateMinRelativeScore,
    semanticCandidateMinSimilarity,
    semanticCandidates: hasCliFlagStrict(argv, "--semantic-candidates"),
    semanticCandidateTopK,
    smartFusion: hasCliFlagStrict(argv, "--smart-fusion"),
    limit,
    live: hasCliFlagStrict(argv, "--live"),
    resume: hasCliFlagStrict(argv, "--resume"),
    outputDir: resolveCliFlagValueStrict(argv, "--output-dir"),
    runId: resolveCliPathSegmentFlagValueStrict(argv, "--run-id"),
  };
  assertProviderEmbeddingTimeoutsRequireProvider(parsed);
  assertProviderRerankingTimeoutRequiresProvider(parsed);
  assertSemanticCandidateTuningRequiresAdmission(parsed);
  assertAnswerPolicyFlagsRequireLive(parsed);
  assertAnswerContextFlagsRequireLive(parsed);
  assertRepairJobFiltersRequireQuestionIdFile(parsed);
  return parsed;
}

function parsePositiveIntegerEnv(envName: string): number | undefined {
  const raw = process.env[envName]?.trim();
  if (!raw) {
    return undefined;
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${envName} must be a positive integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${envName} must be a positive integer.`);
  }
  return value;
}

function parseLocomoCategoryListFlag(
  argv: readonly string[],
  flagName: string,
): LocomoQaCategory[] | undefined {
  const values = parseStringListFlag(argv, flagName);
  if (values === undefined) {
    return undefined;
  }
  const categories: LocomoQaCategory[] = [];
  const seen = new Set<LocomoQaCategory>();
  for (const value of values) {
    if (!LOCOMO_QA_CATEGORY_SET.has(value)) {
      throw new Error(
        `${flagName} must be one of: ${LOCOMO_QA_CATEGORIES.join(", ")}.`,
      );
    }
    const category = value as LocomoQaCategory;
    if (seen.has(category)) {
      throw new Error(`${flagName} contains duplicate value ${category}.`);
    }
    categories.push(category);
    seen.add(category);
  }
  return categories;
}

function parseLocomoRepairJobDiagnosisListFlag(
  argv: readonly string[],
  flagName: string,
): LocomoRepairJobDiagnosis[] | undefined {
  const values = parseUniqueStringListFlag(argv, flagName);
  if (values === undefined) {
    return undefined;
  }
  const diagnoses: LocomoRepairJobDiagnosis[] = [];
  for (const value of values) {
    if (!isLocomoRepairJobDiagnosis(value)) {
      throw new Error(
        `${flagName} must be one of: ${LOCOMO_REPAIR_JOB_DIAGNOSES.join(", ")}.`,
      );
    }
    diagnoses.push(value);
  }
  return diagnoses;
}

function parseLocomoRepairJobRetrievalBucketListFlag(
  argv: readonly string[],
  flagName: string,
): LocomoRepairJobRetrievalBucket[] | undefined {
  const values = parseUniqueStringListFlag(argv, flagName);
  if (values === undefined) {
    return undefined;
  }
  const buckets: LocomoRepairJobRetrievalBucket[] = [];
  for (const value of values) {
    if (!isLocomoRepairJobRetrievalBucket(value)) {
      throw new Error(
        `${flagName} must be one of: ` +
          `${LOCOMO_REPAIR_JOB_RETRIEVAL_BUCKETS.join(", ")}.`,
      );
    }
    buckets.push(value);
  }
  return buckets;
}

function assertRepairJobFiltersRequireQuestionIdFile(
  options: Pick<
    LocomoSmokeCliOptions,
    "questionIdFile" | "repairJobDiagnoses" | "repairJobRetrievalBuckets"
  >,
): void {
  if (options.questionIdFile !== undefined) {
    return;
  }
  if (options.repairJobDiagnoses !== undefined) {
    throw new Error("--repair-job-diagnosis requires --question-id-file.");
  }
  if (options.repairJobRetrievalBuckets !== undefined) {
    throw new Error("--repair-job-retrieval-bucket requires --question-id-file.");
  }
}

function parseUniqueStringListFlag(
  argv: readonly string[],
  flagName: string,
): string[] | undefined {
  const values = parseStringListFlag(argv, flagName);
  if (values === undefined) {
    return undefined;
  }
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`${flagName} contains duplicate value ${value}.`);
    }
    seen.add(value);
  }
  return values;
}

function parseStringListFlag(
  argv: readonly string[],
  flagName: string,
): string[] | undefined {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== flagName) {
      continue;
    }
    const raw = argv[index + 1];
    if (!raw || raw.startsWith("--")) {
      throw new Error(`${flagName} requires a value.`);
    }
    const parts = raw.split(",");
    for (const value of parts) {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        throw new Error(`${flagName} contains an empty value.`);
      }
      values.push(trimmed);
    }
  }
  return values.length === 0 ? undefined : values;
}

function appendUniqueQuestionIds(target: string[], questionIds: string[]): void {
  const seen = new Set(target);
  for (const questionId of questionIds) {
    if (seen.has(questionId)) {
      continue;
    }
    seen.add(questionId);
    target.push(questionId);
  }
}

function assertSameQuestionIdSet(input: {
  left: readonly string[];
  leftLabel: string;
  right: readonly string[];
  rightLabel: string;
  sourcePath: string;
}): void {
  const left = new Set(input.left);
  const right = new Set(input.right);
  const missingFromRight = input.left.filter((questionId) => !right.has(questionId));
  const missingFromLeft = input.right.filter((questionId) => !left.has(questionId));
  if (missingFromRight.length === 0 && missingFromLeft.length === 0) {
    return;
  }
  throw new Error(
    `LoCoMo question id file ${input.sourcePath} ${input.leftLabel} ` +
      `do not match ${input.rightLabel}: ` +
      `missing from ${input.rightLabel} [${missingFromRight.join(", ")}], ` +
      `missing from ${input.leftLabel} [${missingFromLeft.join(", ")}].`,
  );
}

function assertManifestSelectedQuestionCount(input: {
  count: unknown;
  label: string;
  questionIds: readonly string[];
  sourcePath: string;
}): void {
  if (
    typeof input.count !== "number" ||
    !Number.isInteger(input.count) ||
    input.count < 0
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} has invalid ` +
        `overall.selectedQuestionCount ${String(input.count)}.`,
    );
  }
  if (input.count !== input.questionIds.length) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} ` +
        `overall.selectedQuestionCount ${input.count} does not match ` +
        `${input.questionIds.length} ${input.label}.`,
    );
  }
}

function assertUniqueQuestionIds(input: {
  label: string;
  questionIds: readonly string[];
  sourcePath: string;
}): void {
  const seen = new Set<string>();
  for (const questionId of input.questionIds) {
    if (seen.has(questionId)) {
      throw new Error(
        `LoCoMo question id file ${input.sourcePath} ${input.label} ` +
          `has duplicate question id ${questionId}.`,
      );
    }
    seen.add(questionId);
  }
}

function assertManifestCategoryName(input: {
  categoryName: string;
  sourcePath: string;
}): void {
  if (!LOCOMO_QA_CATEGORY_SET.has(input.categoryName)) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} category ` +
        `${input.categoryName} is not recognized.`,
    );
  }
}

type LocomoQuestionIdManifestJobKey = "repairJobs" | "reanswerJobs";

interface LocomoQuestionIdManifestOptions {
  preferManifestJobKeys?: readonly LocomoQuestionIdManifestJobKey[];
  repairJobDiagnoses?: readonly LocomoRepairJobDiagnosis[];
  repairJobRetrievalBuckets?: readonly LocomoRepairJobRetrievalBucket[];
}

function manifestQuestionIds(input: {
  allowMissing?: boolean;
  label: string;
  sourcePath: string;
  value: unknown;
}): string[] {
  if (input.value === undefined && input.allowMissing === true) {
    return [];
  }
  if (!Array.isArray(input.value)) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} ${input.label} ` +
        "questionIds must be an array.",
    );
  }
  const questionIds: string[] = [];
  for (const [index, questionId] of input.value.entries()) {
    if (typeof questionId !== "string") {
      throw new Error(
        `LoCoMo question id file ${input.sourcePath} ${input.label} ` +
          `questionIds contains non-string value at index ${index}.`,
      );
    }
    const trimmedQuestionId = questionId.trim();
    if (trimmedQuestionId.length === 0) {
      throw new Error(
        `LoCoMo question id file ${input.sourcePath} ${input.label} ` +
          `questionIds contains empty string at index ${index}.`,
      );
    }
    if (trimmedQuestionId !== questionId) {
      throw new Error(
        `LoCoMo question id file ${input.sourcePath} ${input.label} ` +
          "questionIds contains leading or trailing whitespace at index " +
          `${index}.`,
      );
    }
    questionIds.push(questionId);
  }
  return questionIds;
}

function manifestSelectionQuestionIds(input: {
  label: string;
  selection: Record<string, unknown>;
  sourcePath: string;
}): string[] {
  const questionIds = manifestQuestionIds({
    label: input.label,
    sourcePath: input.sourcePath,
    value: input.selection.questionIds,
  });
  if (input.selection.questionCount !== undefined) {
    if (
      typeof input.selection.questionCount !== "number" ||
      !Number.isInteger(input.selection.questionCount) ||
      input.selection.questionCount < 0
    ) {
      throw new Error(
        `LoCoMo question id file ${input.sourcePath} has invalid ` +
          `${input.label} questionCount ${String(input.selection.questionCount)}.`,
      );
    }
    if (input.selection.questionCount !== questionIds.length) {
      throw new Error(
        `LoCoMo question id file ${input.sourcePath} ${input.label} ` +
          `questionCount ${input.selection.questionCount} does not match ` +
          `${questionIds.length} questionIds.`,
      );
    }
  }
  const seen = new Set<string>();
  for (const questionId of questionIds) {
    if (seen.has(questionId)) {
      throw new Error(
        `LoCoMo question id file ${input.sourcePath} ${input.label} has ` +
          `duplicate question id ${questionId}.`,
      );
    }
    seen.add(questionId);
  }
  return questionIds;
}

function assertReanswerJobManifestMetadata(input: {
  job: Record<string, unknown>;
  sourcePath: string;
}): void {
  if (
    Object.prototype.hasOwnProperty.call(input.job, "sourceRunId") &&
    typeof input.job.sourceRunId !== "string"
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} reanswerJobs ` +
        "sourceRunId must be a string.",
    );
  }
  if (
    typeof input.job.sourceRunId === "string" &&
    input.job.sourceRunId.trim().length === 0
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} reanswerJobs ` +
        "sourceRunId must not be empty.",
    );
  }
  if (
    typeof input.job.sourceRunId === "string" &&
    input.job.sourceRunId.trim() !== input.job.sourceRunId
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} reanswerJobs ` +
        "sourceRunId must not have leading or trailing whitespace.",
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(input.job, "sourceReportPath") &&
    typeof input.job.sourceReportPath !== "string"
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} reanswerJobs ` +
        "sourceReportPath must be a string.",
    );
  }
  if (
    typeof input.job.sourceReportPath === "string" &&
    input.job.sourceReportPath.trim().length === 0
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} reanswerJobs ` +
        "sourceReportPath must not be empty.",
    );
  }
  if (
    typeof input.job.sourceReportPath === "string" &&
    input.job.sourceReportPath.trim() !== input.job.sourceReportPath
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} reanswerJobs ` +
        "sourceReportPath must not have leading or trailing whitespace.",
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(input.job, "bucket") &&
    typeof input.job.bucket !== "string"
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} reanswerJobs ` +
        "bucket must be a string.",
    );
  }
  if (
    typeof input.job.bucket === "string" &&
    !LOCOMO_REANSWER_JOB_BUCKET_SET.has(input.job.bucket)
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} reanswerJobs ` +
        `bucket ${input.job.bucket} is not recognized.`,
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(input.job, "category") &&
    typeof input.job.category !== "string"
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} reanswerJobs ` +
        "category must be a string.",
    );
  }
  if (
    typeof input.job.category === "string" &&
    !LOCOMO_QA_CATEGORY_SET.has(input.job.category)
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} reanswerJobs ` +
        `category ${input.job.category} is not recognized.`,
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(input.job, "categories") &&
    !Array.isArray(input.job.categories)
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} reanswerJobs ` +
        "categories must be an array.",
    );
  }
  if (!Array.isArray(input.job.categories)) {
    return;
  }
  const seenCategories = new Set<string>();
  for (const [index, category] of input.job.categories.entries()) {
    if (typeof category !== "string") {
      throw new Error(
        `LoCoMo question id file ${input.sourcePath} reanswerJobs ` +
          `categories contains non-string value at index ${index}.`,
      );
    }
    if (!LOCOMO_QA_CATEGORY_SET.has(category)) {
      throw new Error(
        `LoCoMo question id file ${input.sourcePath} reanswerJobs ` +
          `categories value ${category} at index ${index} is not recognized.`,
      );
    }
    if (seenCategories.has(category)) {
      throw new Error(
        `LoCoMo question id file ${input.sourcePath} reanswerJobs ` +
          `categories contains duplicate value ${category}.`,
      );
    }
    seenCategories.add(category);
  }
  if (
    typeof input.job.category === "string" &&
    (input.job.categories.length !== 1 ||
      input.job.categories[0] !== input.job.category)
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} reanswerJobs ` +
        `category ${input.job.category} does not match categories ` +
        `[${input.job.categories.join(", ")}].`,
    );
  }
}

function assertRepairJobManifestMetadata(input: {
  job: Record<string, unknown>;
  sourcePath: string;
}): void {
  if (
    Object.prototype.hasOwnProperty.call(input.job, "diagnosis") &&
    typeof input.job.diagnosis !== "string"
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} repairJobs ` +
        "diagnosis must be a string.",
    );
  }
  if (
    typeof input.job.diagnosis === "string" &&
    !LOCOMO_REPAIR_JOB_DIAGNOSIS_SET.has(input.job.diagnosis)
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} repairJobs ` +
        `diagnosis ${input.job.diagnosis} is not recognized.`,
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(input.job, "retrievalBucket") &&
    typeof input.job.retrievalBucket !== "string"
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} repairJobs ` +
        "retrievalBucket must be a string.",
    );
  }
  if (
    typeof input.job.retrievalBucket === "string" &&
    !LOCOMO_REPAIR_JOB_RETRIEVAL_BUCKET_SET.has(input.job.retrievalBucket)
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} repairJobs ` +
        `retrievalBucket ${input.job.retrievalBucket} is not recognized.`,
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(input.job, "category") &&
    typeof input.job.category !== "string"
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} repairJobs ` +
        "category must be a string.",
    );
  }
  if (
    typeof input.job.category === "string" &&
    !LOCOMO_QA_CATEGORY_SET.has(input.job.category)
  ) {
    throw new Error(
      `LoCoMo question id file ${input.sourcePath} repairJobs ` +
        `category ${input.job.category} is not recognized.`,
    );
  }
}

function repairJobMatchesManifestFilters(
  job: Record<string, unknown>,
  options: Pick<
    LocomoQuestionIdManifestOptions,
    "repairJobDiagnoses" | "repairJobRetrievalBuckets"
  >,
): boolean {
  if (
    options.repairJobDiagnoses !== undefined &&
    (!isLocomoRepairJobDiagnosis(job.diagnosis) ||
      !options.repairJobDiagnoses.includes(job.diagnosis))
  ) {
    return false;
  }
  if (
    options.repairJobRetrievalBuckets !== undefined &&
    (!isLocomoRepairJobRetrievalBucket(job.retrievalBucket) ||
      !options.repairJobRetrievalBuckets.includes(job.retrievalBucket))
  ) {
    return false;
  }
  return true;
}

function collectManifestJobQuestionIds(
  value: Record<string, unknown>,
  jobKeys: readonly LocomoQuestionIdManifestJobKey[],
  sourcePath: string,
  options: Pick<
    LocomoQuestionIdManifestOptions,
    "repairJobDiagnoses" | "repairJobRetrievalBuckets"
  > = {},
): string[] {
  const questionIds: string[] = [];
  for (const key of jobKeys) {
    const jobs = value[key];
    if (
      Object.prototype.hasOwnProperty.call(value, key) &&
      !Array.isArray(jobs)
    ) {
      throw new Error(
        `LoCoMo question id file ${sourcePath} ${key} must be an array.`,
      );
    }
    if (!Array.isArray(jobs)) {
      continue;
    }
    const seenForKey = new Set<string>();
    for (const [index, job] of jobs.entries()) {
      if (!isRecord(job)) {
        throw new Error(
          `LoCoMo question id file ${sourcePath} ${key} entry at index ` +
            `${index} must be an object.`,
        );
      }
      if (key === "repairJobs") {
        assertRepairJobManifestMetadata({
          job,
          sourcePath,
        });
      }
      if (key === "reanswerJobs") {
        assertReanswerJobManifestMetadata({
          job,
          sourcePath,
        });
      }
      const jobQuestionIds = manifestSelectionQuestionIds({
        label: key,
        selection: job,
        sourcePath,
      });
      for (const questionId of jobQuestionIds) {
        if (seenForKey.has(questionId)) {
          throw new Error(
            `LoCoMo question id file ${sourcePath} ${key} selected ` +
              `duplicate question id ${questionId} across jobs.`,
          );
        }
        seenForKey.add(questionId);
      }
      if (
        key === "repairJobs" &&
        !repairJobMatchesManifestFilters(job, options)
      ) {
        continue;
      }
      appendUniqueQuestionIds(questionIds, jobQuestionIds);
    }
  }
  return questionIds;
}

function hasManifestJobKey(
  value: Record<string, unknown>,
  jobKeys: readonly LocomoQuestionIdManifestJobKey[],
): boolean {
  return jobKeys.some((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
}

function hasRepairJobManifestFilters(
  options: Pick<
    LocomoQuestionIdManifestOptions,
    "repairJobDiagnoses" | "repairJobRetrievalBuckets"
  >,
): boolean {
  return (
    options.repairJobDiagnoses !== undefined ||
    options.repairJobRetrievalBuckets !== undefined
  );
}

function assertManifestOverallShape(
  value: Record<string, unknown>,
  sourcePath: string,
): void {
  if (
    Object.prototype.hasOwnProperty.call(value, "overall") &&
    !isRecord(value.overall)
  ) {
    throw new Error(
      `LoCoMo question id file ${sourcePath} overall must be an object.`,
    );
  }
}

function hasNonEmptyManifestSelectionHeader(
  value: Record<string, unknown>,
  sourcePath: string,
): boolean {
  const topLevelQuestionIds = manifestQuestionIds({
    allowMissing: true,
    label: "top-level",
    sourcePath,
    value: value.questionIds,
  });
  assertUniqueQuestionIds({
    label: "top-level",
    questionIds: topLevelQuestionIds,
    sourcePath,
  });
  let hasNonEmptyHeader = topLevelQuestionIds.length > 0;
  if (
    Object.prototype.hasOwnProperty.call(value, "categories") &&
    !isRecord(value.categories)
  ) {
    throw new Error(
      `LoCoMo question id file ${sourcePath} categories must be an object.`,
    );
  }
  if (!isRecord(value.categories)) {
    return hasNonEmptyHeader;
  }
  const seenForCategories = new Set<string>();
  const selectedCategoryQuestionIds: string[] = [];
  for (const [categoryName, category] of Object.entries(value.categories)) {
    assertManifestCategoryName({ categoryName, sourcePath });
    if (!isRecord(category)) {
      throw new Error(
        `LoCoMo question id file ${sourcePath} category ${categoryName} ` +
          "must be an object.",
      );
    }
    const categoryQuestionIds = manifestSelectionQuestionIds({
      label: "category",
      selection: category,
      sourcePath,
    });
    for (const questionId of categoryQuestionIds) {
      if (seenForCategories.has(questionId)) {
        throw new Error(
          `LoCoMo question id file ${sourcePath} categories selected ` +
            `duplicate question id ${questionId} across categories.`,
        );
      }
      seenForCategories.add(questionId);
    }
    appendUniqueQuestionIds(selectedCategoryQuestionIds, categoryQuestionIds);
    if (categoryQuestionIds.length > 0) {
      hasNonEmptyHeader = true;
    }
  }
  if (
    topLevelQuestionIds.length > 0 &&
    selectedCategoryQuestionIds.length > 0
  ) {
    assertSameQuestionIdSet({
      left: topLevelQuestionIds,
      leftLabel: "top-level questionIds",
      right: selectedCategoryQuestionIds,
      rightLabel: "category questionIds",
      sourcePath,
    });
  }
  if (
    topLevelQuestionIds.length > 0 &&
    isRecord(value.overall) &&
    value.overall.selectedQuestionCount !== undefined
  ) {
    assertManifestSelectedQuestionCount({
      count: value.overall.selectedQuestionCount,
      label: "top-level questionIds",
      questionIds: topLevelQuestionIds,
      sourcePath,
    });
  }
  if (
    selectedCategoryQuestionIds.length > 0 &&
    isRecord(value.overall) &&
    value.overall.selectedQuestionCount !== undefined
  ) {
    assertManifestSelectedQuestionCount({
      count: value.overall.selectedQuestionCount,
      label: "category questionIds",
      questionIds: selectedCategoryQuestionIds,
      sourcePath,
    });
  }
  return hasNonEmptyHeader;
}

function collectQuestionIdsFromManifest(
  value: unknown,
  sourcePath: string,
  options: LocomoQuestionIdManifestOptions = {},
): string[] {
  if (!isRecord(value)) {
    return [];
  }
  assertManifestOverallShape(value, sourcePath);
  const preferManifestJobKeys =
    options.preferManifestJobKeys ??
    (hasRepairJobManifestFilters(options) ? (["repairJobs"] as const) : undefined);
  if (preferManifestJobKeys !== undefined) {
    const preferredQuestionIds = collectManifestJobQuestionIds(
      value,
      preferManifestJobKeys,
      sourcePath,
      options,
    );
    const preferredManifestJobKeyPresent = hasManifestJobKey(
      value,
      preferManifestJobKeys,
    );
    const hasNonEmptySelectionHeader =
      preferredQuestionIds.length > 0 || preferredManifestJobKeyPresent
        ? hasNonEmptyManifestSelectionHeader(value, sourcePath)
        : false;
    if (
      preferredManifestJobKeyPresent &&
      !hasNonEmptySelectionHeader &&
      isRecord(value.overall) &&
      value.overall.selectedQuestionCount !== undefined
    ) {
      assertManifestSelectedQuestionCount({
        count: value.overall.selectedQuestionCount,
        label: `preferred ${preferManifestJobKeys.join("/")} questionIds`,
        questionIds: preferredQuestionIds,
        sourcePath,
      });
    }
    if (
      preferredQuestionIds.length > 0 ||
      preferredManifestJobKeyPresent
    ) {
      return preferredQuestionIds;
    }
  }
  const questionIds: string[] = [];
  const topLevelQuestionIds = manifestQuestionIds({
      allowMissing: true,
      label: "top-level",
      sourcePath,
      value: value.questionIds,
  });
  assertUniqueQuestionIds({
    label: "top-level",
    questionIds: topLevelQuestionIds,
    sourcePath,
  });
  appendUniqueQuestionIds(questionIds, topLevelQuestionIds);
  const jobQuestionIds = collectManifestJobQuestionIds(
    value,
    ["repairJobs", "reanswerJobs"],
    sourcePath,
    options,
  );
  const hasRepairOrReanswerJobKey = hasManifestJobKey(value, [
    "repairJobs",
    "reanswerJobs",
  ]);
  appendUniqueQuestionIds(questionIds, jobQuestionIds);
  const hasNonEmptySelectionHeaderForJobCount =
    topLevelQuestionIds.length > 0 ||
    hasNonEmptyManifestSelectionHeader(value, sourcePath);
  if (
    topLevelQuestionIds.length > 0 &&
    isRecord(value.overall) &&
    value.overall.selectedQuestionCount !== undefined
  ) {
    assertManifestSelectedQuestionCount({
      count: value.overall.selectedQuestionCount,
      label: "top-level questionIds",
      questionIds: topLevelQuestionIds,
      sourcePath,
    });
  }
  if (
    !hasNonEmptySelectionHeaderForJobCount &&
    hasRepairOrReanswerJobKey &&
    isRecord(value.overall) &&
    value.overall.selectedQuestionCount !== undefined
  ) {
    assertManifestSelectedQuestionCount({
      count: value.overall.selectedQuestionCount,
      label: "repair/reanswer questionIds",
      questionIds: jobQuestionIds,
      sourcePath,
    });
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "categories") &&
    !isRecord(value.categories)
  ) {
    throw new Error(
      `LoCoMo question id file ${sourcePath} categories must be an object.`,
    );
  }
  if (isRecord(value.categories)) {
    const seenForCategories = new Set<string>();
    const categoryQuestionIds: string[] = [];
    for (const [categoryName, category] of Object.entries(value.categories)) {
      assertManifestCategoryName({ categoryName, sourcePath });
      if (!isRecord(category)) {
        throw new Error(
          `LoCoMo question id file ${sourcePath} category ${categoryName} ` +
            "must be an object.",
        );
      }
      const selectedCategoryQuestionIds = manifestSelectionQuestionIds({
        label: "category",
        selection: category,
        sourcePath,
      });
      for (const questionId of selectedCategoryQuestionIds) {
        if (seenForCategories.has(questionId)) {
          throw new Error(
            `LoCoMo question id file ${sourcePath} categories selected ` +
              `duplicate question id ${questionId} across categories.`,
          );
        }
        seenForCategories.add(questionId);
      }
      appendUniqueQuestionIds(categoryQuestionIds, selectedCategoryQuestionIds);
      appendUniqueQuestionIds(questionIds, selectedCategoryQuestionIds);
    }
    if (
      isRecord(value.overall) &&
      value.overall.selectedQuestionCount !== undefined
    ) {
      assertManifestSelectedQuestionCount({
        count: value.overall.selectedQuestionCount,
        label: "category questionIds",
        questionIds: categoryQuestionIds,
        sourcePath,
      });
    }
    if (topLevelQuestionIds.length > 0 && categoryQuestionIds.length > 0) {
      assertSameQuestionIdSet({
        left: topLevelQuestionIds,
        leftLabel: "top-level questionIds",
        right: categoryQuestionIds,
        rightLabel: "category questionIds",
        sourcePath,
      });
    }
  }
  return questionIds;
}

export function parseLocomoQuestionIdsFile(
  contents: string,
  sourcePath: string,
  options: LocomoQuestionIdManifestOptions = {},
): string[] {
  const trimmed = contents.trim();
  if (trimmed.length === 0) {
    throw new Error(`LoCoMo question id file ${sourcePath} is empty.`);
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const questionIds = Array.isArray(parsed)
      ? manifestQuestionIds({
          label: "JSON array",
          sourcePath,
          value: parsed,
        })
      : collectQuestionIdsFromManifest(parsed, sourcePath, options);
    if (Array.isArray(parsed)) {
      assertUniqueQuestionIds({
        label: "JSON array",
        questionIds,
        sourcePath,
      });
    }
    if (questionIds.length === 0) {
      throw new Error(
        `LoCoMo question id file ${sourcePath} JSON did not contain questionIds.`,
      );
    }
    return questionIds;
  } catch (error: unknown) {
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      throw error;
    }
  }
  const questionIds = trimmed
    .split(",")
    .flatMap((segment) => {
      const segmentText = segment.trim();
      if (segmentText.length === 0) {
        throw new Error(
          `LoCoMo question id file ${sourcePath} text list contains ` +
            "empty question id entry.",
        );
      }
      return segmentText.split(/\s+/u);
    });
  if (questionIds.length === 0) {
    throw new Error(
      `LoCoMo question id file ${sourcePath} did not contain question ids.`,
    );
  }
  assertUniqueQuestionIds({
    label: "text list",
    questionIds,
    sourcePath,
  });
  return questionIds;
}

export async function resolveLocomoQuestionIds(input: {
  explicitQuestionIds?: readonly string[];
  preferManifestJobKeys?: readonly LocomoQuestionIdManifestJobKey[];
  questionIdFile?: string;
  questionIdFileContents?: string;
  repairJobDiagnoses?: readonly LocomoRepairJobDiagnosis[];
  repairJobRetrievalBuckets?: readonly LocomoRepairJobRetrievalBucket[];
  readFile: (path: string) => Promise<string>;
}): Promise<string[] | undefined> {
  const questionIds: string[] = [];
  const explicitQuestionIds = [...(input.explicitQuestionIds ?? [])];
  assertUniqueQuestionIds({
    label: "explicit question ids",
    questionIds: explicitQuestionIds,
    sourcePath: "CLI",
  });
  appendUniqueQuestionIds(questionIds, explicitQuestionIds);
  if (input.questionIdFile) {
    const questionIdFileContents =
      input.questionIdFileContents ?? (await input.readFile(input.questionIdFile));
    const parsedQuestionIds = parseLocomoQuestionIdsFile(
      questionIdFileContents,
      input.questionIdFile,
      {
        preferManifestJobKeys: input.preferManifestJobKeys,
        repairJobDiagnoses: input.repairJobDiagnoses,
        repairJobRetrievalBuckets: input.repairJobRetrievalBuckets,
      },
    );
    const explicitQuestionIdSet = new Set(explicitQuestionIds);
    for (const questionId of parsedQuestionIds) {
      if (explicitQuestionIdSet.has(questionId)) {
        throw new Error(
          `LoCoMo question id file ${input.questionIdFile} explicit ` +
            "question ids overlap question-id-file question id " +
            `${questionId}.`,
        );
      }
    }
    appendUniqueQuestionIds(
      questionIds,
      parsedQuestionIds,
    );
  }
  return questionIds.length === 0 ? undefined : questionIds;
}

function parsePositiveIntegerFlag(
  argv: readonly string[],
  flagName: string,
): number | undefined {
  const raw = resolveNumericFlagValue(argv, flagName);
  if (raw === undefined) {
    return undefined;
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${flagName} must be a positive integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${flagName} must be a positive integer.`);
  }
  return value;
}

function parseNonNegativeIntegerFlag(
  argv: readonly string[],
  flagName: string,
): number | undefined {
  const raw = resolveNumericFlagValue(argv, flagName);
  if (raw === undefined) {
    return undefined;
  }
  if (!/^(0|[1-9]\d*)$/.test(raw)) {
    throw new Error(`${flagName} must be a non-negative integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${flagName} must be a non-negative integer.`);
  }
  return value;
}

function parseNonNegativeNumberFlag(
  argv: readonly string[],
  flagName: string,
): number | undefined {
  const raw = resolveNumericFlagValue(argv, flagName);
  if (raw === undefined) {
    return undefined;
  }
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(raw)) {
    throw new Error(`${flagName} must be a non-negative number.`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${flagName} must be a non-negative number.`);
  }
  return value;
}

function parseUnitIntervalFlag(
  argv: readonly string[],
  flagName: string,
): number | undefined {
  const raw = resolveNumericFlagValue(argv, flagName);
  if (raw === undefined) {
    return undefined;
  }
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(raw)) {
    throw new Error(`${flagName} must be greater than 0 and at most 1.`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${flagName} must be greater than 0 and at most 1.`);
  }
  return value;
}

function resolveNumericFlagValue(
  argv: readonly string[],
  flagName: string,
): string | undefined {
  return resolveCliFlagValueStrict(argv, flagName);
}

export function buildLocomoScope(input: {
  caseId: string;
  runId: string;
}): { agentId: string; sessionId: string; userId: string; workspaceId: string } {
  return {
    agentId: "phase-65-locomo-smoke",
    sessionId: `case-${input.caseId}`,
    userId: `locomo:${input.caseId}`,
    workspaceId: `phase-65-locomo:${input.runId}`,
  };
}

// The other participant in a (two-speaker) LoCoMo conversation.
export function otherLocomoSpeaker(
  testCase: LocomoCase,
  speaker: string,
): string {
  return testCase.speakers.find((candidate) => candidate !== speaker) ?? speaker;
}

// Deterministic speaker-coreference normalization (GATEWAY-FREE). Rewrites
// first-person pronouns to the speaker's name and second-person pronouns to the
// other speaker, so a question that names a participant can lexically match a
// turn where that participant spoke in the first person ("Why did Jon start the
// studio?" against Jon's "I lost my job"). Bridges the coreference half of the
// LoCoMo phrasing gap with no LLM; the synonym half ("destress" vs "stress
// relief") still needs semantics. Faithful (resolves pronouns, drops no facts).
export function resolveSpeakerCoref(
  content: string,
  speaker: string,
  otherSpeaker: string,
): string {
  const possessive = (name: string): string =>
    /s$/i.test(name) ? `${name}'` : `${name}'s`;
  const replacements: Array<[RegExp, string]> = [
    [/\bI'm\b/g, `${speaker} is`],
    [/\bI've\b/g, `${speaker} has`],
    [/\bI'll\b/g, `${speaker} will`],
    [/\bI'd\b/g, `${speaker} would`],
    [/\bmyself\b/gi, speaker],
    [/\bmine\b/gi, possessive(speaker)],
    [/\bmy\b/gi, possessive(speaker)],
    [/\bme\b/gi, speaker],
    [/\bI\b/g, speaker],
    [/\byourself\b/gi, otherSpeaker],
    [/\byou're\b/gi, `${otherSpeaker} is`],
    [/\byours\b/gi, possessive(otherSpeaker)],
    [/\byour\b/gi, possessive(otherSpeaker)],
    [/\byou\b/gi, otherSpeaker],
  ];
  let result = content;
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export async function seedLocomoCase(input: {
  corefNormalize?: boolean;
  labelFreeIngest?: boolean;
  memory: GoodMemory;
  runId: string;
  testCase: LocomoCase;
}): Promise<void> {
  const { turns } = input.testCase;
  const renderTurnContent = (turn: LocomoTurn): string => {
    const text = input.corefNormalize
      ? resolveSpeakerCoref(
          turn.content,
          turn.speaker,
          otherLocomoSpeaker(input.testCase, turn.speaker),
        )
      : turn.content;
    const dateTag = turn.date ? ` date=${turn.date}` : "";
    return `[LOCOMO dia_id=${turn.diaId} speaker=${turn.speaker}${dateTag}] ${text}`;
  };
  await input.memory.remember({
    annotations: turns.map((turn, messageIndex) => ({
      confirmed: true,
      kindHint: "fact" as const,
      messageIndex,
      metadataPatch: {
        attributes: {
          diaId: turn.diaId,
          speaker: turn.speaker,
        },
        ...(input.labelFreeIngest
          ? {}
          : {
              category: "external_benchmark" as const,
              tags: ["locomo", `dia_id:${turn.diaId}`],
            }),
      },
      reason: input.labelFreeIngest
        ? "Preserve the raw source turn for retrieval evaluation."
        : "LoCoMo smoke preserves every dialog turn as retrievable evidence.",
      remember: "always" as const,
      verified: true,
    })),
    extractionStrategy: "rules-only",
    // Force user role so rules-only extraction keeps every turn; the true
    // speaker is preserved in attributes and the content prefix.
    messages: turns.map((turn) => ({
      content: renderTurnContent(turn),
      role: "user",
    })),
    scope: buildLocomoScope({
      caseId: input.testCase.caseId,
      runId: input.runId,
    }),
  });
}

// Lexical overlap (Szymkiewicz-Simpson) between a normalized fact and its source
// turn. A fact that closely echoes its raw turn added little normalization and
// only inflates the candidate pool; a low-overlap fact genuinely bridged a
// phrasing gap (coreference resolution, restructuring) and is worth keeping.
export function locomoFactTurnOverlap(
  factContent: string,
  turnContent: string,
): number {
  const tokens = (value: string): Set<string> =>
    new Set(
      (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
        (token) => token.length > 2,
      ),
    );
  const factTokens = tokens(factContent);
  const turnTokens = tokens(turnContent);
  if (factTokens.size === 0 || turnTokens.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of factTokens) {
    if (turnTokens.has(token)) {
      intersection += 1;
    }
  }
  return intersection / Math.min(factTokens.size, turnTokens.size);
}

// Above this fact-vs-turn overlap a conversational fact is treated as a near-copy
// of its raw turn (no phrasing-gap value) and dropped under smart fusion, to
// fight the candidate-pool dilution measured when every fact is stored.
const LOCOMO_SMART_FUSION_OVERLAP_THRESHOLD = 0.8;

// Conversational atomic-fact ingest (improvement-plan #3). Instead of storing raw
// dialogue turns, decompose each session into self-contained, coreference-resolved,
// entity/date-normalized atomic claims via the injected LLM extractor and store
// those as the retrievable unit, preserving each fact's source dia_id so the SAME
// evidence-turn recall metric (scoreLocomoRetrieval) applies unchanged. Sessions
// are extracted independently to preserve within-session coreference context.
// Opt-in; only used when --conversational-extraction is set. When smartFusion is
// set, facts that merely echo their raw turn (high overlap) are dropped so only
// genuinely-normalized, phrasing-gap-bridging facts augment the raw turns.
export async function seedLocomoCaseConversational(input: {
  extractor: MemoryExtractor;
  maxConcurrency?: number;
  memory: GoodMemory;
  runId: string;
  smartFusion?: boolean;
  testCase: LocomoCase;
}): Promise<void> {
  const scope = buildLocomoScope({
    caseId: input.testCase.caseId,
    runId: input.runId,
  });
  const sessions = new Map<string, LocomoTurn[]>();
  for (const turn of input.testCase.turns) {
    const sessionKey = turn.diaId.split(":")[0] ?? turn.diaId;
    const list = sessions.get(sessionKey) ?? [];
    list.push(turn);
    sessions.set(sessionKey, list);
  }
  const sessionGroups = [...sessions.values()];
  const extractions = new Array<
    Awaited<ReturnType<MemoryExtractor["extract"]>>
  >(sessionGroups.length);
  let nextSessionIndex = 0;
  const extractNextSession = async (): Promise<void> => {
    while (nextSessionIndex < sessionGroups.length) {
      const index = nextSessionIndex;
      nextSessionIndex += 1;
      const sessionTurns = sessionGroups[index]!;
      extractions[index] = await input.extractor.extract({
        scope,
        messages: sessionTurns.map((turn) => ({
          content: `${turn.speaker}: ${turn.content}`,
          role: "user",
        })),
      });
    }
  };
  const workerCount = Math.min(
    sessionGroups.length,
    Math.max(1, Math.floor(input.maxConcurrency ?? 1)),
  );
  await Promise.all(
    Array.from({ length: workerCount }, () => extractNextSession()),
  );

  for (const [index, sessionTurns] of sessionGroups.entries()) {
    const extraction = extractions[index]!;
    const resolveTurn = (index: number): LocomoTurn =>
      sessionTurns[Math.max(0, Math.min(index, sessionTurns.length - 1))]!;
    let facts = extraction.candidates.filter(
      (candidate) => candidate.kindHint !== "noise",
    );
    if (input.smartFusion) {
      facts = facts.filter(
        (fact) =>
          locomoFactTurnOverlap(
            fact.content,
            resolveTurn(fact.sourceMessageIndex).content,
          ) < LOCOMO_SMART_FUSION_OVERLAP_THRESHOLD,
      );
    }
    if (facts.length === 0) {
      continue;
    }
    await input.memory.remember({
      annotations: facts.map((fact, messageIndex) => {
        const turn = resolveTurn(fact.sourceMessageIndex);
        return {
          confirmed: true,
          kindHint: "fact" as const,
          messageIndex,
          metadataPatch: {
            attributes: { diaId: turn.diaId, speaker: turn.speaker },
            category: "external_benchmark",
            tags: ["locomo", `dia_id:${turn.diaId}`],
          },
          reason:
            "LoCoMo conversational atomic-fact extraction preserves source dia_id provenance.",
          remember: "always" as const,
          verified: true,
        };
      }),
      extractionStrategy: "rules-only",
      messages: facts.map((fact) => {
        const turn = resolveTurn(fact.sourceMessageIndex);
        return {
          content: `[LOCOMO dia_id=${turn.diaId} speaker=${turn.speaker}${turn.date ? ` date=${turn.date}` : ""}] ${fact.content}`,
          role: "user",
        };
      }),
      scope,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return typeof value === "boolean" || value === null;
}

function isNullableFailureStage(
  value: unknown,
): value is LocomoExecutionFailureStage | null {
  return (
    value === null ||
    value === "answer" ||
    value === "provider-run-timeout" ||
    value === "recall" ||
    value === "seed"
  );
}

function isLocomoProgressCategory(value: unknown): value is LocomoQaCategory {
  return typeof value === "string" && LOCOMO_QA_CATEGORY_SET.has(value);
}

function isLocomoProgressRow(value: unknown): value is LocomoQuestionRetrieval {
  if (!isRecord(value)) {
    return false;
  }
  const answerTokenF1 = value.answerTokenF1;
  const executionFailureMessage = value.executionFailureMessage;
  const executionFailureStage = value.executionFailureStage;
  return (
    isNullableBoolean(value.answerCorrect) &&
    typeof value.caseId === "string" &&
    value.caseId.trim() === value.caseId &&
    value.caseId.length > 0 &&
    isLocomoProgressCategory(value.category) &&
    typeof value.evidenceRecall === "number" &&
    Number.isFinite(value.evidenceRecall) &&
    value.evidenceRecall >= 0 &&
    value.evidenceRecall <= 1 &&
    isStringArray(value.evidenceTurnIds) &&
    (executionFailureMessage === undefined ||
      executionFailureMessage === null ||
      (typeof executionFailureMessage === "string" &&
        executionFailureMessage.trim().length > 0 &&
        executionFailureMessage.trim() === executionFailureMessage)) &&
    (executionFailureStage === undefined ||
      isNullableFailureStage(executionFailureStage)) &&
    isNullableString(value.generatedAnswer) &&
    typeof value.goldEvidenceFullyRetrieved === "boolean" &&
    isStringArray(value.missingEvidenceTurnIds) &&
    typeof value.noiseTurnCount === "number" &&
    Number.isInteger(value.noiseTurnCount) &&
    value.noiseTurnCount >= 0 &&
    isStringArray(value.noiseTurnIds) &&
    typeof value.questionId === "string" &&
    value.questionId.trim() === value.questionId &&
    value.questionId.length > 0 &&
    isStringArray(value.retrievedTurnIds) &&
    (answerTokenF1 === undefined ||
      answerTokenF1 === null ||
      (typeof answerTokenF1 === "number" &&
        Number.isFinite(answerTokenF1) &&
        answerTokenF1 >= 0 &&
        answerTokenF1 <= 1))
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withLocomoExecutionFailure(
  result: LocomoQuestionRetrieval,
  failure: {
    message: string;
    stage: LocomoExecutionFailureStage;
  },
): LocomoQuestionRetrieval {
  return {
    ...result,
    executionFailureMessage: failure.message,
    executionFailureStage: failure.stage,
  };
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJsonStringify(value)).digest("hex");
}

export function collectLocomoTurnIdsFromRecord(record: unknown): string[] {
  if (!isRecord(record)) {
    return [];
  }
  const ids: string[] = [];
  const collectFromText = (value: unknown): void => {
    if (typeof value !== "string") {
      return;
    }
    for (const match of value.matchAll(/\bdia_id[:=](D\d+:\d+)/gu)) {
      const id = match[1];
      if (id !== undefined) {
        ids.push(id);
      }
    }
  };

  collectFromText(record.content);
  if (Array.isArray(record.tags)) {
    for (const tag of record.tags) {
      collectFromText(tag);
    }
  }
  if (isRecord(record.attributes)) {
    const { diaId, dia_id: snakeDiaId } = record.attributes;
    if (typeof diaId === "string") {
      ids.push(diaId);
    }
    if (typeof snakeDiaId === "string") {
      ids.push(snakeDiaId);
    }
  }
  return ids;
}

export function collectLocomoRetrievedTurnIds(recall: RecallResult): string[] {
  const recallRecord = recall as unknown as Record<string, unknown>;
  const ids = new Set<string>();
  for (const key of [
    "preferences",
    "references",
    "facts",
    "feedback",
    "archives",
    "evidence",
    "episodes",
  ]) {
    const records = recallRecord[key];
    if (!Array.isArray(records)) {
      continue;
    }
    for (const record of records) {
      for (const id of collectLocomoTurnIdsFromRecord(record)) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}

export function collectLocomoPacketTurnIds(
  recall: Pick<RecallResult, "packet">,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of (recall.packet.factSummary ?? "").matchAll(
    /\bdia_id[:=](D\d+:\d+)/gu,
  )) {
    const id = match[1];
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function scoreLocomoRetrieval(input: {
  question: LocomoQuestion;
  retrievedTurnIds: string[];
  testCase: LocomoCase;
}): LocomoQuestionRetrieval {
  const { question } = input;
  const retrieved = new Set(input.retrievedTurnIds);
  const evidenceHit = question.evidenceTurnIds.filter((id) =>
    retrieved.has(id),
  ).length;
  const evidenceRecall =
    question.evidenceTurnIds.length === 0
      ? 1
      : evidenceHit / question.evidenceTurnIds.length;
  const evidenceSet = new Set(question.evidenceTurnIds);
  const missingEvidenceTurnIds = question.evidenceTurnIds.filter(
    (id) => !retrieved.has(id),
  );
  // Noise is a retrieved turn that is not gold evidence for this question.
  const noiseTurnIds = input.retrievedTurnIds.filter(
    (id, index, all) => !evidenceSet.has(id) && all.indexOf(id) === index,
  );

  return {
    answerCorrect: null,
    answerTokenF1: null,
    caseId: input.testCase.caseId,
    category: question.category,
    evidenceRecall,
    evidenceTurnIds: question.evidenceTurnIds,
    generatedAnswer: null,
    goldEvidenceFullyRetrieved: evidenceRecall === 1,
    missingEvidenceTurnIds,
    noiseTurnCount: noiseTurnIds.length,
    noiseTurnIds,
    questionId: question.questionId,
    retrievedTurnIds: input.retrievedTurnIds,
  };
}

// Build the answer-generation context from the turns recall actually surfaced,
// in source order. This is what a live generator (or judge) sees.
export function buildLocomoAnswerContext(input: {
  retrievedTurnIds: readonly string[];
  testCase: LocomoCase;
}): string {
  const retrieved = new Set(input.retrievedTurnIds);
  return input.testCase.turns
    .filter((turn) => retrieved.has(turn.diaId))
    .map((turn) => `- dia_id=${turn.diaId} (${turn.speaker}): ${turn.content}`)
    .join("\n");
}

function locomoEvidencePackQuestionType(
  category: LocomoQaCategory,
): string | undefined {
  if (category === "multi_hop") {
    return "multi_session_reasoning";
  }
  if (category === "adversarial") {
    return "abstention";
  }
  return undefined;
}

// Evidence-pack variant of the answer context. LoCoMo turns carry no wall-clock
// timestamp, so the answer-time order key is the turn's position in the
// conversation and the time anchor is its 1-based session index (sessions run in
// chronological order upstream). The shared pack then applies the same
// operation-framing + current-value resolution validated on BEAM and MAB, with
// no LoCoMo-specific tuning.
export function buildLocomoEvidencePackContext(input: {
  chainOfNote?: boolean;
  question: LocomoQuestion;
  retrievedTurnIds: readonly string[];
  testCase: LocomoCase;
}): string {
  const retrieved = new Set(input.retrievedTurnIds);
  const turns: EvidenceTurn[] = input.testCase.turns
    .map((turn, index) => ({ index, turn }))
    .filter(({ turn }) => retrieved.has(turn.diaId))
    .map(({ index, turn }) => ({
      content: turn.content,
      orderKey: index,
      role: turn.speaker,
      sourceId: turn.diaId,
      timeAnchor: turn.date ?? `session ${parseLocomoSession(turn.diaId)}`,
    }));
  return buildAnswerEvidencePack({
    chainOfNote: input.chainOfNote,
    question: input.question.question,
    questionType: locomoEvidencePackQuestionType(input.question.category),
    turns,
  });
}

// Answer from the records recall ACTUALLY surfaced (raw turns plus any
// normalized conversational facts), rather than reconstructing raw turns by
// dia_id. This mirrors the product answer path (answer over recalled facts via
// buildContext) and lets the answer model see the self-contained, coref-resolved
// claims that bridged the phrasing gap during retrieval -- the assembly side of
// the "assembly, not storage, is the bottleneck" finding. Records are ordered by
// source dia_id so multi-session reasoning sees chronological context.
export function buildLocomoRecalledContext(input: {
  recall: RecallResult;
}): string {
  const parsed = (input.recall.facts ?? []).map((fact) => {
    const content = typeof fact.content === "string" ? fact.content : "";
    const match = content.match(
      /\[LOCOMO dia_id=(D\d+:\d+) speaker=(.*?)(?: date=([^\]]*))?\]\s*([\s\S]*)$/,
    );
    if (match) {
      return {
        diaId: match[1] ?? "",
        speaker: (match[2] ?? "").trim(),
        date: (match[3] ?? "").trim(),
        text: (match[4] ?? "").trim(),
      };
    }
    return { diaId: "", speaker: "", date: "", text: content.trim() };
  });
  parsed.sort((left, right) =>
    left.diaId.localeCompare(right.diaId, undefined, { numeric: true }),
  );
  // Surface the absolute session date alongside each record so the answer model
  // can resolve relative dates ("last Saturday") to the gold's absolute date.
  return parsed
    .map((record) => {
      if (!record.diaId) {
        return `- ${record.text}`;
      }
      const who = record.date
        ? `${record.speaker}, ${record.date}`
        : record.speaker;
      return `- dia_id=${record.diaId} (${who}): ${record.text}`;
    })
    .join("\n");
}

const LOCOMO_ANSWER_SYSTEM =
  "You answer questions about a long multi-session conversation using only the supplied dialog context. Combining facts across sessions is expected. Answer with the shortest phrase that is correct; if the answer is not present in the context, say you do not know rather than guessing. For questions about WHEN something happened, give the absolute date (resolve relative references like \"last week\" or \"yesterday\" using the session dates shown in the context). For count or frequency questions, answer in the requested frequency form when possible, such as \"twice\" instead of a bare \"2\" for how-many-times questions. Output only the final answer with no explanation.";

export function buildLocomoSystemPrompt(input: {
  allowCommonsenseResolution?: boolean;
  chainOfNote?: boolean;
  questionCategory?: LocomoQaCategory;
  strictNoEvidenceAbstention?: boolean;
}): string {
  const instructions = [LOCOMO_ANSWER_SYSTEM];
  if (input.chainOfNote) {
    instructions.push(
      'Exception to the output rule: the dialog context ends with a reading protocol. Follow it — first write one brief note per evidence entry citing its #id, then give the answer on a final line beginning with "Final answer:". Only that line is your answer and it must obey every answer-shape rule above; the notes are discarded.',
    );
  }
  if (input.questionCategory === "multi_hop") {
    instructions.push(
      "For multi-hop questions, compose the final answer from every required evidence link; return the requested final entity, count, relationship, or attribute, and do not stop at the first matching clue or quote a partial chain.",
    );
  }
  if (
    input.allowCommonsenseResolution &&
    (input.questionCategory === undefined ||
      input.questionCategory === "open_domain")
  ) {
    instructions.push(
      "When the dialog explicitly provides the underlying entity, activity, or place, you may use common general world knowledge to resolve it to the concise requested form. Answer the requested type directly, such as the full console, company, place, style, or category name, rather than only a manufacturer, topic, or clue.",
    );
  }
  if (
    input.strictNoEvidenceAbstention &&
    (input.questionCategory === undefined ||
      input.questionCategory === "adversarial")
  ) {
    instructions.push(
      "For no-answer or adversarial questions, give a concrete answer only when the dialog directly states the requested relationship; if the retrieved dialog merely mentions nearby objects, people, places, or topics, answer exactly \"I do not know\".",
    );
  }
  return instructions.join(" ");
}

export function buildLocomoPrompt(input: {
  allowCommonsenseResolution?: boolean;
  memoryContext: string;
  question: string;
}): string {
  const answerInstruction = input.allowCommonsenseResolution
    ? "Answer concisely using the dialog context above as the source of entities and relationships; if the system permits commonsense resolution, use only common knowledge needed to bridge those dialog-supported entities to the requested answer type. Return only the answer."
    : "Answer concisely using only the dialog context above. Return only the answer.";
  return [
    "Dialog context:",
    input.memoryContext.trim().length > 0 ? input.memoryContext : "(none)",
    `Question:\n${input.question}`,
    answerInstruction,
  ].join("\n\n");
}

export const LOCOMO_LIVE_ANSWER_SYSTEM_ID =
  "locomo-live-category-aware-v1";
export const LOCOMO_LIVE_REQUEST_TIMEOUT_MS = 120_000;

// Real LLM generator (deterministic token-F1 / exact / adversarial scoring
// downstream, so no judge).
export function createLocomoLiveAnswerGenerator(input: {
  allowCommonsenseResolution?: boolean;
  chainOfNote?: boolean;
  strictNoEvidenceAbstention?: boolean;
} = {}): LocomoAnswerGenerator {
  const model = resolveLiveModelConfig("GOODMEMORY_EVAL");
  return async (answerInput) => {
    const system = buildLocomoSystemPrompt({
      allowCommonsenseResolution: input.allowCommonsenseResolution,
      chainOfNote: input.chainOfNote,
      questionCategory: answerInput.question.category,
      strictNoEvidenceAbstention: input.strictNoEvidenceAbstention,
    });
    const raw = await withAISDKRetries(() =>
      requestOpenAICompatibleText({
        model,
        prompt: buildLocomoPrompt({
          allowCommonsenseResolution:
            input.allowCommonsenseResolution &&
            answerInput.question.category === "open_domain",
          memoryContext: answerInput.memoryContext,
          question: answerInput.question.question,
        }),
        system,
        timeoutMs: LOCOMO_LIVE_REQUEST_TIMEOUT_MS,
      }),
    );
    // Reasoning models (gpt-5.x) emit a <think>...</think> block before the
    // answer; the text path does not strip it (only the structured path does),
    // so strip it here or it pollutes the deterministic token-F1 score.
    return stripThinkingBlocks(raw);
  };
}

export function summarizeLocomoRetrieval(
  results: readonly LocomoQuestionRetrieval[],
): LocomoCategoryRetrievalSummary[] {
  return LOCOMO_QA_CATEGORIES.map((category) => {
    const bucket = results.filter((result) => result.category === category);
    const questionCount = bucket.length;
    const fullyRetrievedCount = bucket.filter(
      (result) => result.goldEvidenceFullyRetrieved,
    ).length;
    const answered = bucket.filter((result) => result.answerCorrect !== null);
    const answeredCount = answered.length;
    return {
      answerAccuracy:
        answeredCount === 0
          ? null
          : answered.filter((result) => result.answerCorrect === true).length /
            answeredCount,
      answeredCount,
      averageEvidenceRecall:
        questionCount === 0
          ? 0
          : bucket.reduce((sum, result) => sum + result.evidenceRecall, 0) /
            questionCount,
      category,
      // Multi-hop composition needs every evidence turn retrievable; the
      // retrieval-only smoke reports readiness, not the composed answer.
      crossSessionChainReady:
        category === "multi_hop"
          ? questionCount > 0 && fullyRetrievedCount === questionCount
          : null,
      fullyRetrievedCount,
      noiseTurnTotal: bucket.reduce(
        (sum, result) => sum + result.noiseTurnCount,
        0,
      ),
      questionCount,
    };
  });
}

// Question-weighted overall evidence-turn recall across all categories -- the
// single headline number for an embedding-free retrieval comparison.
export function overallLocomoEvidenceRecall(
  results: readonly LocomoQuestionRetrieval[],
): number {
  if (results.length === 0) {
    return 0;
  }
  const total = results.reduce((sum, result) => sum + result.evidenceRecall, 0);
  return total / results.length;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function createSmokeEmbeddingAdapter(): EmbeddingAdapter {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((text) => {
        const hash = hashString(text);
        return [hash % 997, (hash >> 3) % 997, (hash >> 7) % 997];
      });
    },
  };
}

function createNoopAssistedExtractor(): MemoryExtractor {
  return {
    async extract(input) {
      return {
        candidates: [],
        ignoredMessageCount: input.messages.length,
      };
    },
  };
}

export function createLocomoSmokeMemory(
  options: {
    bm25?: boolean;
    generalizedFusion?: boolean;
    providerEmbedding?: boolean;
    providerEmbeddingConfig?: GoodMemoryEmbeddingProviderConfig;
    providerEmbeddingTimeoutMs?: number;
    providerRerankingConfig?: GoodMemoryRerankingProviderConfig;
    providerRerankingStrategy?: "listwise" | "pointwise";
    rerank?: boolean;
    retrievalCueAdapter?: {
      generate(input: {
        category: string;
        content: string;
        subject?: string;
      }): Promise<string[]>;
      // Honored by the maintenance job config; the smoke backfill raises it so
      // one enumeration round sees every seeded fact.
      maxFactsPerRun?: number;
    };
    semanticCandidates?: boolean;
    semanticCandidateMaxAdditions?: number;
    semanticCandidateMinRelativeScore?: number;
    semanticCandidateMinSimilarity?: number;
    semanticCandidateTopK?: number;
    fusionMinRelativeStrength?: number;
    entityPageRank?: boolean;
  } = {},
): GoodMemory {
  assertProviderEmbeddingTimeoutsRequireProvider(options);
  assertSemanticCandidateTuningRequiresAdmission(options);
  // Deterministic id and clock seams keep repeated smoke runs reproducible:
  // ranking tie-breaks fall back to fact-id and timestamp comparisons.
  let idCounter = 0;
  let clockTick = 0;
  // BM25 mode measures the pure Okapi BM25 lexical leg: enable bm25Ranking and
  // drop the hashed smoke embedding so the additive ranking slot is BM25 alone
  // (recall runs under the "hybrid" strategy, which is where the leg applies).
  // The gateway-free lexical-coverage reranker is the embedding-free second stage
  // over the top-K (Move 5).
  const adapters: NonNullable<GoodMemoryConfig["adapters"]> = {
    assistedExtractor: createNoopAssistedExtractor(),
    ...(options.retrievalCueAdapter
      ? { retrievalCueGenerator: options.retrievalCueAdapter }
      : {}),
  };
  if (options.providerEmbedding && options.bm25) {
    throw new Error(
      "--provider-embedding cannot be combined with --bm25; hybrid recall uses the embedding branch before the BM25 fallback.",
    );
  }
  if (options.semanticCandidates && options.bm25) {
    throw new Error(
      "--semantic-candidates cannot be combined with --bm25; semantic candidate admission requires an embedding-backed recall branch.",
    );
  }
  if (options.generalizedFusion && options.bm25) {
    throw new Error(
      "--generalized-fusion cannot be combined with --bm25; generalized fusion already owns the BM25 channel.",
    );
  }
  if (options.providerEmbedding && options.providerEmbeddingTimeoutMs !== undefined) {
    const model = options.providerEmbeddingConfig
      ? {
          apiKey: options.providerEmbeddingConfig.apiKey,
          baseURL: options.providerEmbeddingConfig.baseURL,
          model: options.providerEmbeddingConfig.model,
          provider: options.providerEmbeddingConfig.provider,
        }
      : resolveProviderBackedModelConfig("GOODMEMORY_EMBEDDING");
    adapters.embeddingAdapter = createProviderEmbeddingAdapter({
      model,
      requestTimeoutMs: options.providerEmbeddingTimeoutMs,
    });
  } else if (
    !options.bm25 &&
    !options.providerEmbedding &&
    !options.generalizedFusion
  ) {
    adapters.embeddingAdapter = createSmokeEmbeddingAdapter();
  }
  if (options.rerank) {
    adapters.reranker = createLexicalCoverageReranker();
  }
  const retrieval: NonNullable<GoodMemoryConfig["retrieval"]> = {
    ...(options.generalizedFusion ? { preset: "recommended" as const } : {}),
    ...(options.generalizedFusion &&
    options.fusionMinRelativeStrength !== undefined
      ? {
          generalizedFusionMinRelativeStrength:
            options.fusionMinRelativeStrength,
        }
      : {}),
    ...(options.generalizedFusion && options.entityPageRank
      ? { generalizedFusionEntityPageRank: true }
      : {}),
    ...(options.bm25 ? { bm25Ranking: true } : {}),
    ...(options.semanticCandidates
      ? {
          semanticCandidates: {
            ...(options.semanticCandidateMaxAdditions !== undefined
              ? { maxAdditions: options.semanticCandidateMaxAdditions }
              : {}),
            ...(options.semanticCandidateMinSimilarity !== undefined
              ? { minSimilarity: options.semanticCandidateMinSimilarity }
              : {}),
            ...(options.semanticCandidateMinRelativeScore !== undefined
              ? { minRelativeScore: options.semanticCandidateMinRelativeScore }
              : {}),
            ...(options.semanticCandidateTopK !== undefined
              ? { topK: options.semanticCandidateTopK }
              : {}),
          },
        }
      : {}),
  };
  const providers: NonNullable<GoodMemoryConfig["providers"]> = {
    ...(options.providerEmbeddingConfig &&
    options.providerEmbeddingTimeoutMs === undefined
      ? { embedding: options.providerEmbeddingConfig }
      : {}),
    ...(options.providerRerankingConfig
      ? { reranking: options.providerRerankingConfig }
      : {}),
  };
  const memory = createInternalGoodMemory(
    {
      ...(Object.keys(retrieval).length > 0 ? { retrieval } : {}),
      ...(Object.keys(adapters).length > 0 ? { adapters } : {}),
      ...(Object.keys(providers).length > 0 ? { providers } : {}),
      storage: {
        provider: "memory",
      },
      testing: {
        createId: () => {
          idCounter += 1;
          return `locomo-smoke-${String(idCounter).padStart(6, "0")}`;
        },
        now: () => {
          clockTick += 1;
          return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, clockTick));
        },
      },
    },
    {
      environment: options.providerEmbedding ? process.env : {},
      projectionBulkBackfill: true,
      projectionWriteThrough: false,
      ...(options.providerRerankingStrategy
        ? { providerRerankingStrategy: options.providerRerankingStrategy }
        : {}),
    },
  );
  if (
    options.providerEmbedding &&
    inspectGoodMemoryRuntime(memory)?.embeddingEnabled !== true
  ) {
    throw new Error(
      "--provider-embedding requires GOODMEMORY_EMBEDDING_PROVIDER, GOODMEMORY_EMBEDDING_MODEL, and GOODMEMORY_EMBEDDING_API_KEY (or an injected embedding provider config).",
    );
  }
  return memory;
}

function assertNormalizedCase(value: unknown, index: number): LocomoCase {
  if (
    !isRecord(value) ||
    typeof value.caseId !== "string" ||
    !Array.isArray(value.turns) ||
    !Array.isArray(value.questions)
  ) {
    throw new Error(
      `LoCoMo external case at index ${index} is not a normalized case (need caseId, turns[], questions[]).`,
    );
  }
  return value as unknown as LocomoCase;
}

export function deriveLocomoUpstreamMetricByCategory(
  cases: readonly LocomoCase[],
): Partial<Record<LocomoQaCategory, string>> {
  const metrics: Partial<Record<LocomoQaCategory, string>> = {};
  for (const testCase of cases) {
    for (const question of testCase.questions) {
      metrics[question.category] = question.matchMode;
    }
  }
  return metrics;
}

export async function loadLocomoCases(input: {
  benchmarkRoot?: string;
  caseIds?: readonly string[];
  limit?: number;
  questionIds?: readonly string[];
  questionCategories?: readonly LocomoQaCategory[];
  readFile: (path: string) => Promise<string>;
}): Promise<{
  benchmarkFingerprint: string;
  benchmarkSource: string;
  cases: LocomoCase[];
}> {
  let cases: LocomoCase[];
  let benchmarkFingerprint: string;
  let benchmarkSource: string;
  if (input.benchmarkRoot) {
    const path = join(input.benchmarkRoot, EXTERNAL_CASES_FILE_NAME);
    const parsed = JSON.parse(await input.readFile(path)) as unknown;
    const rawCases = isRecord(parsed) ? parsed.cases : parsed;
    if (!Array.isArray(rawCases)) {
      throw new Error(
        `LoCoMo external root ${path} must contain a cases array (or {cases: [...]}).`,
      );
    }
    cases = rawCases.map((value, index) => assertNormalizedCase(value, index));
    benchmarkFingerprint = sha256(parsed);
    benchmarkSource = path;
  } else {
    cases = buildLocomoSmokeCases();
    benchmarkFingerprint = sha256(cases);
    benchmarkSource = "synthetic-smoke";
  }
  if (input.caseIds && input.caseIds.length > 0) {
    const requested = new Set(input.caseIds);
    cases = cases.filter((testCase) => requested.has(testCase.caseId));
    const found = new Set(cases.map((testCase) => testCase.caseId));
    const missing = input.caseIds.filter((caseId) => !found.has(caseId));
    if (missing.length > 0) {
      throw new Error(
        `LoCoMo case id(s) not found in ${benchmarkSource}: ${missing.join(", ")}`,
      );
    }
  }
  if (input.questionCategories && input.questionCategories.length > 0) {
    const requested = new Set(input.questionCategories);
    cases = cases
      .map((testCase) => ({
        ...testCase,
        questions: testCase.questions.filter((question) =>
          requested.has(question.category),
        ),
      }))
      .filter((testCase) => testCase.questions.length > 0);
    if (cases.length === 0) {
      throw new Error(
        `LoCoMo category filter matched no questions in ${benchmarkSource}: ` +
          input.questionCategories.join(", "),
      );
    }
    const found = new Set(
      cases.flatMap((testCase) =>
        testCase.questions.map((question) => question.category),
      ),
    );
    const missing = input.questionCategories.filter(
      (category) => !found.has(category),
    );
    if (missing.length > 0) {
      throw new Error(
        `LoCoMo category id(s) not found in ${benchmarkSource}: ` +
          missing.join(", "),
      );
    }
  }
  if (input.questionIds && input.questionIds.length > 0) {
    const requested = new Set(input.questionIds);
    cases = cases
      .map((testCase) => ({
        ...testCase,
        questions: testCase.questions.filter((question) =>
          requested.has(question.questionId),
        ),
      }))
      .filter((testCase) => testCase.questions.length > 0);
    const found = new Set(
      cases.flatMap((testCase) =>
        testCase.questions.map((question) => question.questionId),
      ),
    );
    const selectedQuestionCaseById = new Map<string, string>();
    for (const testCase of cases) {
      for (const question of testCase.questions) {
        const firstCaseId = selectedQuestionCaseById.get(question.questionId);
        if (firstCaseId !== undefined) {
          throw new Error(
            `LoCoMo question id ${question.questionId} matched multiple ` +
              `questions in ${benchmarkSource}: ${firstCaseId} and ` +
              `${testCase.caseId}.`,
          );
        }
        selectedQuestionCaseById.set(question.questionId, testCase.caseId);
      }
    }
    const missing = input.questionIds.filter(
      (questionId) => !found.has(questionId),
    );
    if (missing.length > 0) {
      throw new Error(
        `LoCoMo question id(s) not found in ${benchmarkSource}: ${missing.join(", ")}`,
      );
    }
  }
  if (input.limit !== undefined) {
    cases = cases.slice(0, input.limit);
  }
  return { benchmarkFingerprint, benchmarkSource, cases };
}

export function locomoQuestionKey(caseId: string, questionId: string): string {
  return `${caseId}::${questionId}`;
}

interface LocomoProgressConfig {
  allowCommonsenseResolution: boolean;
  strictNoEvidenceAbstention: boolean;
  answerContextMode: LocomoAnswerContextMode;
  benchmarkSource: string;
  benchmarkFingerprint: string;
  bm25Ranking: boolean;
  caseIds: string[];
  concurrency: number;
  corefNormalize: boolean;
  decompose: boolean;
  externalRoot: string | null;
  generalizedFusionConfig: LocomoSmokeReport["generalizedFusionConfig"];
  ingestMode: LocomoSmokeReport["ingestMode"];
  labelFreeIngest: boolean;
  limit: number | null;
  liveAnswer: boolean;
  modelConfig: {
    embedding: Record<string, string | null>;
    eval: Record<string, string | null>;
  };
  multiHop: boolean;
  providerEmbedding: boolean;
  providerEmbeddingRunTimeoutMs: number | null;
  providerEmbeddingTimeoutMs: number | null;
  providerReranking: boolean;
  providerRerankingTimeoutMs: number | null;
  questionCategories: LocomoQaCategory[] | null;
  questionIds: string[] | null;
  questions: Array<{
    caseId: string;
    category: LocomoQaCategory;
    questionId: string;
  }>;
  recallStrategy: "hybrid" | "rules-only";
  rerankGeneralizedFusionConfig: LocomoSmokeReport["rerankGeneralizedFusionConfig"];
  rerank: boolean;
  runId: string;
  semanticCandidateEmbeddingSource: LocomoSmokeReport["semanticCandidateEmbeddingSource"];
  semanticCandidates: LocomoSmokeReport["semanticCandidates"];
  smartFusion: boolean;
}

interface LocomoProgressHeader {
  config: LocomoProgressConfig;
  configFingerprint: string;
  kind: typeof LOCOMO_PROGRESS_CONFIG_KIND;
  version: 2;
}

function resolveLocomoAnswerContextMode(
  options: Pick<
    LocomoSmokeCliOptions,
    "answerFromPacket" | "answerFromRecalled" | "evidencePack"
  >,
): LocomoAnswerContextMode {
  if (options.answerFromRecalled) {
    return "recalled-records";
  }
  if (options.answerFromPacket) {
    return "packet-evidence-pack";
  }
  if (options.evidencePack) {
    return "evidence-pack";
  }
  return "raw-turns";
}

function locomoSemanticCandidateConfig(
  options: Pick<
    LocomoSmokeCliOptions,
    | "semanticCandidateMaxAdditions"
    | "semanticCandidateMinRelativeScore"
    | "semanticCandidateMinSimilarity"
    | "semanticCandidates"
    | "semanticCandidateTopK"
  >,
): LocomoSmokeReport["semanticCandidates"] {
  return {
    enabled: options.semanticCandidates ?? false,
    maxAdditions: options.semanticCandidateMaxAdditions ?? null,
    minRelativeScore: options.semanticCandidateMinRelativeScore ?? null,
    minSimilarity: options.semanticCandidateMinSimilarity ?? null,
    topK: options.semanticCandidateTopK ?? null,
  };
}

function locomoGeneralizedFusionConfig(
  enabled: boolean,
  fusionMinRelativeStrength?: number,
  entityPageRank?: boolean,
): NonNullable<LocomoSmokeReport["generalizedFusionConfig"]> | null {
  // Config honesty: record the WIRED floor. The bare recommended preset
  // leaves minRelativeStrength unset and the engine then runs 0 (no
  // trimming) — earlier reports recorded the 0.35 library constant while
  // the engine ran 0 (declared-not-wired; see the research doc's floor
  // sweep note).
  return enabled
    ? {
        ...(entityPageRank ? { entityPageRank: true } : {}),
        maxCandidates: RECOMMENDED_GENERALIZED_FUSION_MAX_CANDIDATES,
        maxTotalFacts: RECOMMENDED_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
        minRelativeStrength: fusionMinRelativeStrength ?? 0,
        rrfK: DEFAULT_GENERALIZED_FUSION_RRF_K,
      }
    : null;
}

function locomoRerankGeneralizedFusionConfig(
  enabled: boolean,
): NonNullable<LocomoSmokeReport["rerankGeneralizedFusionConfig"]> | null {
  return enabled
    ? {
        maxCandidates:
          RECOMMENDED_RERANK_GENERALIZED_FUSION_MAX_CANDIDATES,
        maxTotalFacts: RECOMMENDED_RERANK_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
      }
    : null;
}

function buildLocomoQuestionSelection(
  options: Pick<
    LocomoSmokeCliOptions,
    | "questionIdFile"
    | "questionIds"
    | "repairJobDiagnoses"
    | "repairJobRetrievalBuckets"
  >,
): LocomoSmokeReport["questionSelection"] | undefined {
  if (
    options.questionIds === undefined &&
    options.questionIdFile === undefined &&
    options.repairJobDiagnoses === undefined &&
    options.repairJobRetrievalBuckets === undefined
  ) {
    return undefined;
  }
  return {
    explicitQuestionIds: options.questionIds ?? null,
    questionIdFile: options.questionIdFile ?? null,
    repairJobDiagnoses: options.repairJobDiagnoses ?? null,
    repairJobRetrievalBuckets: options.repairJobRetrievalBuckets ?? null,
  };
}

function publicModelConfig(prefix: string): Record<string, string | null> {
  return {
    baseURL: process.env[`${prefix}_BASE_URL`] ?? null,
    model: process.env[`${prefix}_MODEL`] ?? null,
    provider: process.env[`${prefix}_PROVIDER`] ?? null,
  };
}

function buildLocomoProgressConfig(input: {
  answerContextMode: LocomoAnswerContextMode;
  benchmarkSource: string;
  benchmarkFingerprint: string;
  cases: readonly LocomoCase[];
  liveAnswer: boolean;
  options: LocomoSmokeCliOptions;
  recallStrategy: "hybrid" | "rules-only";
  runId: string;
  semanticCandidateEmbeddingSource: LocomoSmokeReport["semanticCandidateEmbeddingSource"];
  semanticCandidates: LocomoSmokeReport["semanticCandidates"];
}): LocomoProgressConfig {
  return {
    allowCommonsenseResolution: input.options.allowCommonsenseResolution ?? false,
    strictNoEvidenceAbstention:
      input.options.strictNoEvidenceAbstention ?? false,
    answerContextMode: input.answerContextMode,
    benchmarkFingerprint: input.benchmarkFingerprint,
    benchmarkSource: input.benchmarkSource,
    bm25Ranking: input.options.bm25 ?? false,
    caseIds: input.cases.map((testCase) => testCase.caseId),
    concurrency: input.options.concurrency ?? 1,
    corefNormalize: input.options.corefNormalize ?? false,
    decompose: input.options.decompose ?? false,
    externalRoot: input.options.benchmarkRoot ?? null,
    generalizedFusionConfig: locomoGeneralizedFusionConfig(
      input.options.generalizedFusion ?? false,
      input.options.fusionMinRelativeStrength,
      input.options.entityPageRank,
    ),
    ingestMode: input.options.conversationalExtraction
      ? "conversational-extraction"
      : "raw-turns",
    labelFreeIngest: input.options.labelFreeIngest ?? false,
    limit: input.options.limit ?? null,
    liveAnswer: input.liveAnswer,
    modelConfig: {
      embedding: publicModelConfig("GOODMEMORY_EMBEDDING"),
      eval: publicModelConfig("GOODMEMORY_EVAL"),
    },
    multiHop: input.options.multiHop ?? false,
    providerEmbedding: input.options.providerEmbedding ?? false,
    providerEmbeddingRunTimeoutMs:
      input.options.providerEmbeddingRunTimeoutMs ?? null,
    providerEmbeddingTimeoutMs: input.options.providerEmbeddingTimeoutMs ?? null,
    providerReranking: input.options.providerReranking ?? false,
    providerRerankingTimeoutMs:
      input.options.providerRerankingTimeoutMs ?? null,
    questionCategories: input.options.questionCategories ?? null,
    questionIds: input.options.questionIds ?? null,
    questions: input.cases.flatMap((testCase) =>
      testCase.questions.map((question) => ({
        caseId: testCase.caseId,
        category: question.category,
        questionId: question.questionId,
      })),
    ),
    recallStrategy: input.recallStrategy,
    rerankGeneralizedFusionConfig: locomoRerankGeneralizedFusionConfig(
      (input.options.generalizedFusion ?? false) &&
        (input.options.providerReranking ?? false),
    ),
    rerank: input.options.rerank ?? false,
    runId: input.runId,
    semanticCandidateEmbeddingSource: input.semanticCandidateEmbeddingSource,
    semanticCandidates: input.semanticCandidates,
    smartFusion: input.options.smartFusion ?? false,
  };
}

function buildLocomoProgressHeader(
  config: LocomoProgressConfig,
): LocomoProgressHeader {
  return {
    config,
    configFingerprint: sha256(config),
    kind: LOCOMO_PROGRESS_CONFIG_KIND,
    version: 2,
  };
}

function buildLocomoProgressConfigLine(header: LocomoProgressHeader): string {
  return `${JSON.stringify(header)}\n`;
}

function isLocomoProgressHeader(value: unknown): value is LocomoProgressHeader {
  return (
    isRecord(value) &&
    value.kind === LOCOMO_PROGRESS_CONFIG_KIND &&
    value.version === 2 &&
    typeof value.configFingerprint === "string" &&
    isRecord(value.config)
  );
}

function readLocomoProgressHeader(raw: string): LocomoProgressHeader | null {
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const value = JSON.parse(trimmed) as unknown;
      if (isLocomoProgressHeader(value)) {
        return value;
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

function assertLocomoProgressConfigMatches(input: {
  expected: LocomoProgressHeader;
  progressPath: string;
  raw: string;
}): void {
  const actual = readLocomoProgressHeader(input.raw);
  if (actual === null) {
    throw new Error(
      `LoCoMo progress file ${input.progressPath} does not include a valid version 2 config header; rerun without --resume or choose a new --run-id.`,
    );
  }
  if (actual.configFingerprint !== sha256(actual.config)) {
    throw new Error(
      `LoCoMo progress config fingerprint is invalid for ${input.progressPath}; ` +
        "rerun without --resume or choose a new --run-id.",
    );
  }
  if (actual.configFingerprint !== input.expected.configFingerprint) {
    throw new Error(
      `LoCoMo progress config fingerprint mismatch for ${input.progressPath}: ` +
        `checkpoint=${actual.configFingerprint}, current=${input.expected.configFingerprint}. ` +
        "Rerun without --resume or choose a new --run-id.",
    );
  }
}

// Parse a live-progress.jsonl checkpoint. Broken tail lines (a write interrupted
// by the crash the checkpoint exists to survive) are skipped, not fatal.
export function parseLocomoProgressLines(raw: string): LocomoQuestionRetrieval[] {
  const results: LocomoQuestionRetrieval[] = [];
  const lines = raw.split("\n");
  for (const [lineIndex, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch (error) {
      if (!(error instanceof SyntaxError && lineIndex === lines.length - 1)) {
        throw new Error(`malformed LoCoMo progress line ${lineIndex + 1}.`);
      }
      // skip a partial tail line from a killed run
      continue;
    }
    if (isLocomoProgressRow(value)) {
      results.push(value);
      continue;
    }
    if (
      isLocomoProgressHeader(value) &&
      value.configFingerprint === sha256(value.config)
    ) {
      continue;
    }
    throw new Error(`malformed LoCoMo progress line ${lineIndex + 1}.`);
  }
  return results;
}

export function readLocomoProgressRowsForSelection(input: {
  progressPath: string;
  raw: string;
  selectedQuestionKeys: ReadonlySet<string>;
}): LocomoQuestionRetrieval[] {
  const rows = parseLocomoProgressLines(input.raw);
  const seen = new Set<string>();
  for (const row of rows) {
    const key = locomoQuestionKey(row.caseId, row.questionId);
    if (seen.has(key)) {
      throw new Error(
        `duplicate LoCoMo progress row for ${key} at ${input.progressPath}.`,
      );
    }
    seen.add(key);
    if (!input.selectedQuestionKeys.has(key)) {
      throw new Error(
        `LoCoMo progress row ${key} is outside selected scope at ` +
          `${input.progressPath}.`,
      );
    }
  }
  return rows;
}

function rescoreCompletedLocomoResult(
  result: LocomoQuestionRetrieval,
  question: LocomoQuestion,
): LocomoQuestionRetrieval {
  if (result.generatedAnswer === null) {
    return result;
  }
  return {
    ...result,
    answerCorrect: scoreLocomoAnswer({
      adversarialAnswer: question.adversarialAnswer,
      answer: result.generatedAnswer,
      goldAnswer: question.goldAnswer,
      matchMode: question.matchMode,
    }),
    answerTokenF1: locomoTokenF1(result.generatedAnswer, question.goldAnswer),
  };
}

// Content-addressed session-extraction cache. The key hashes the exact extract()
// messages plus a config tag (the eval model), so a cache entry is only reused
// for the identical session content under the identical extractor config.
export function wrapMemoryExtractorWithJsonlCache(
  extractor: MemoryExtractor,
  io: {
    appendFile: (path: string, data: string) => Promise<void>;
    cachePath: string;
    configTag: string;
    initialCache: ReadonlyMap<string, unknown>;
  },
): MemoryExtractor {
  const cache = new Map(io.initialCache);
  let appendQueue = Promise.resolve();
  return {
    async extract(input) {
      const key = `${io.configTag}:${hashString(JSON.stringify(input.messages))}`;
      const cached = cache.get(key);
      if (cached !== undefined) {
        // Only candidates are cached; ignoredMessageCount is a live-extraction
        // diagnostic and is reported as 0 on replay.
        return {
          candidates: cached,
          ignoredMessageCount: 0,
        } as Awaited<ReturnType<MemoryExtractor["extract"]>>;
      }
      const extraction = await extractor.extract(input);
      cache.set(key, extraction.candidates);
      appendQueue = appendQueue
        .then(() =>
          io.appendFile(
            io.cachePath,
            `${JSON.stringify({ candidates: extraction.candidates, key })}\n`,
          ),
        )
        .catch(() => undefined);
      await appendQueue;
      return extraction;
    },
  };
}

export function parseLocomoExtractionCacheLines(
  raw: string,
): Map<string, unknown> {
  const cache = new Map<string, unknown>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const value = JSON.parse(trimmed) as unknown;
      if (isRecord(value) && typeof value.key === "string" && Array.isArray(value.candidates)) {
        cache.set(value.key, value.candidates);
      }
    } catch {
      // skip partial line
    }
  }
  return cache;
}

function createLocomoProviderEmbeddingRunDeadline(input: {
  nowMs: () => number;
  options: Pick<
    LocomoSmokeCliOptions,
    "providerEmbedding" | "providerEmbeddingRunTimeoutMs"
  >;
}): LocomoProviderEmbeddingRunDeadline | null {
  if (
    input.options.providerEmbedding !== true ||
    input.options.providerEmbeddingRunTimeoutMs === undefined
  ) {
    return null;
  }
  return {
    deadlineMs: input.nowMs() + input.options.providerEmbeddingRunTimeoutMs,
    timeoutMs: input.options.providerEmbeddingRunTimeoutMs,
  };
}

function assertLocomoProviderEmbeddingRunDeadline(input: {
  deadline: LocomoProviderEmbeddingRunDeadline | null;
  nowMs: () => number;
  stage: string;
}): void {
  if (input.deadline === null) {
    return;
  }
  if (input.nowMs() >= input.deadline.deadlineMs) {
    throw new LocomoProviderEmbeddingRunTimeoutError(
      input.deadline.timeoutMs,
      input.stage,
    );
  }
}

export async function runLocomoSmoke(
  options: LocomoSmokeCliOptions = {},
  dependencies: LocomoSmokeDependencies = {},
): Promise<LocomoSmokeReport> {
  assertSemanticCandidateTuningRequiresAdmission(options);
  assertProviderEmbeddingTimeoutsRequireProvider(options);
  assertProviderRerankingTimeoutRequiresProvider(options);
  const liveAnswerRequested =
    options.live === true || dependencies.answerGenerator !== undefined;
  const answerFlagOptions = {
    ...options,
    live: liveAnswerRequested,
  };
  assertAnswerPolicyFlagsRequireLive(answerFlagOptions);
  assertAnswerContextFlagsRequireLive(answerFlagOptions);
  if (options.semanticCandidates && options.bm25) {
    throw new Error(
      "--semantic-candidates cannot be combined with --bm25; semantic candidate admission requires an embedding-backed recall branch.",
    );
  }
  if (options.generalizedFusion && options.bm25) {
    throw new Error(
      "--generalized-fusion cannot be combined with --bm25; generalized fusion already owns the BM25 channel.",
    );
  }
  const concurrency = options.concurrency ?? 1;
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error("LoCoMo concurrency must be a positive integer.");
  }
  if (concurrency > 1 && options.providerEmbeddingRunTimeoutMs !== undefined) {
    throw new Error(
      "Concurrent LoCoMo runs cannot use providerEmbeddingRunTimeoutMs; use per-request timeouts and the resumable checkpoint.",
    );
  }
  const repoRoot = resolveRepoRootFromScriptUrl(import.meta.url);
  const readFileImpl =
    dependencies.readFile ?? ((path: string) => readFile(path, "utf8"));
  const writeFileImpl = dependencies.writeFile ?? writeFile;
  const mkdirImpl = dependencies.mkdir ?? mkdir;
  const now = dependencies.now ?? (() => new Date());
  const nowMs = dependencies.nowMs ?? (() => Date.now());
  const providerRerankingConfig = (() => {
    if (!options.providerReranking || dependencies.createMemory) {
      return undefined;
    }
    const model = resolveLiveModelConfig("GOODMEMORY_EVAL");
    return {
      apiKey: model.apiKey!,
      baseURL: model.baseURL,
      model: model.model,
      provider: model.provider,
      ...(options.providerRerankingTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.providerRerankingTimeoutMs }),
    };
  })();
  if (options.retrievalCues && dependencies.createMemory) {
    throw new Error(
      "--retrieval-cues requires the built-in memory factory; it cannot be combined with an injected createMemory dependency.",
    );
  }
  // R6 backfill transport: the maintenance job calls the adapter one fact at a
  // time, so the runner records the requested inputs first (returning no cues
  // keeps every fact uncovered), prefetches generations concurrently, then
  // replays the job against the prefetched map — the stored bytes go through
  // the shipped job exactly as a sequential run would write them.
  const cueDispatch = options.retrievalCues
    ? {
        handler: async (_input: {
          category: string;
          content: string;
          subject?: string;
        }): Promise<string[]> => [],
      }
    : undefined;
  const createMemory =
    dependencies.createMemory ??
    (() =>
      createLocomoSmokeMemory({
        bm25: options.bm25,
        generalizedFusion: options.generalizedFusion,
        fusionMinRelativeStrength: options.fusionMinRelativeStrength,
        entityPageRank: options.entityPageRank,
        providerEmbedding: options.providerEmbedding,
        providerEmbeddingTimeoutMs: options.providerEmbeddingTimeoutMs,
        providerRerankingConfig,
        rerank: options.rerank,
        ...(cueDispatch
          ? {
              retrievalCueAdapter: {
                generate: (input) => cueDispatch.handler(input),
                maxFactsPerRun: 1_000_000,
              },
            }
          : {}),
        semanticCandidateMaxAdditions: options.semanticCandidateMaxAdditions,
        semanticCandidateMinRelativeScore:
          options.semanticCandidateMinRelativeScore,
        semanticCandidateMinSimilarity: options.semanticCandidateMinSimilarity,
        semanticCandidates: options.semanticCandidates,
        semanticCandidateTopK: options.semanticCandidateTopK,
      }));
  // BM25 ranking and semantic candidate generation both apply under the "hybrid"
  // strategy; the default stays on the pure-lexical rules-only floor.
  const recallStrategy: "hybrid" | "rules-only" =
    options.bm25 || options.semanticCandidates || options.generalizedFusion
    ? "hybrid"
    : "rules-only";
  const semanticCandidateEmbeddingSource = options.providerEmbedding
    ? "provider"
    : options.bm25 || options.generalizedFusion
      ? "none"
      : "smoke-hash";
  const runId = options.runId ?? LOCOMO_SMOKE_RUN_ID;
  const outputDir =
    options.outputDir ??
    join(repoRoot, "reports", "eval", "research", "phase-65", "locomo");
  const runDirectory = join(outputDir, runId);

  const appendFileImpl = dependencies.appendFile ?? appendFile;
  const questionIds = await resolveLocomoQuestionIds({
    explicitQuestionIds: options.questionIds,
    preferManifestJobKeys:
      options.repairJobDiagnoses !== undefined ||
      options.repairJobRetrievalBuckets !== undefined
        ? ["repairJobs"]
        : undefined,
    questionIdFile: options.questionIdFile,
    repairJobDiagnoses: options.repairJobDiagnoses,
    repairJobRetrievalBuckets: options.repairJobRetrievalBuckets,
    readFile: readFileImpl,
  });
  const resolvedOptions: LocomoSmokeCliOptions = {
    ...options,
    questionIds,
  };
  const providerEmbeddingRunDeadline = createLocomoProviderEmbeddingRunDeadline({
    nowMs,
    options: resolvedOptions,
  });
  const assertProviderRunDeadline = (stage: string): void =>
    assertLocomoProviderEmbeddingRunDeadline({
      deadline: providerEmbeddingRunDeadline,
      nowMs,
      stage,
    });

  const { benchmarkFingerprint, benchmarkSource, cases } = await loadLocomoCases({
    benchmarkRoot: resolvedOptions.benchmarkRoot,
    caseIds: resolvedOptions.caseIds,
    limit: resolvedOptions.limit,
    questionIds: resolvedOptions.questionIds,
    questionCategories: resolvedOptions.questionCategories,
    readFile: readFileImpl,
  });

  const answerGenerator =
    dependencies.answerGenerator ??
    (options.live
      ? createLocomoLiveAnswerGenerator({
          allowCommonsenseResolution: options.allowCommonsenseResolution,
          strictNoEvidenceAbstention: options.strictNoEvidenceAbstention,
        })
      : undefined);
  const liveAnswer = answerGenerator !== undefined;
  const answerContextMode = resolveLocomoAnswerContextMode(options);
  const semanticCandidates = locomoSemanticCandidateConfig(options);
  const progressHeader = buildLocomoProgressHeader(
    buildLocomoProgressConfig({
      answerContextMode,
      benchmarkFingerprint,
      benchmarkSource,
      cases,
      liveAnswer,
      options: resolvedOptions,
      recallStrategy,
      runId,
      semanticCandidateEmbeddingSource,
      semanticCandidates,
    }),
  );

  // The run directory exists from the start so the per-question checkpoint and
  // the extraction cache can be appended to during the run, not only at the end.
  await mkdirImpl(runDirectory, { recursive: true });
  // Checkpointing exists to survive gateway/provider outages, so it is active
  // for expensive model-backed modes: live answers, LLM extraction, and
  // provider-backed retrieval. Deterministic retrieval-only runs are cheap to
  // recompute and stay byte-identical to the pre-checkpoint runner.
  const checkpointing =
    answerGenerator !== undefined ||
    options.conversationalExtraction === true ||
    options.providerEmbedding === true ||
    options.providerReranking === true;
  const progressPath = join(runDirectory, LOCOMO_LIVE_PROGRESS_FILE_NAME);
  const completed = new Map<string, LocomoQuestionRetrieval>();
  const selectedQuestionKeys = new Set(
    cases.flatMap((testCase) =>
      testCase.questions.map((question) =>
        locomoQuestionKey(testCase.caseId, question.questionId),
      ),
    ),
  );
  if (checkpointing && options.resume) {
    let progress = "";
    try {
      progress = await readFileImpl(progressPath);
    } catch {
      // no checkpoint yet -> fresh run
    }
    if (progress.trim().length > 0) {
      assertLocomoProgressConfigMatches({
        expected: progressHeader,
        progressPath,
        raw: progress,
      });
      for (const result of readLocomoProgressRowsForSelection({
        progressPath,
        raw: progress,
        selectedQuestionKeys,
      })) {
        completed.set(locomoQuestionKey(result.caseId, result.questionId), result);
      }
    } else {
      await writeFileImpl(
        progressPath,
        buildLocomoProgressConfigLine(progressHeader),
      );
    }
  } else if (checkpointing) {
    // A fresh (non-resume) run must not inherit a stale checkpoint.
    await writeFileImpl(
      progressPath,
      buildLocomoProgressConfigLine(progressHeader),
    );
  }

  const conversationalExtractor = options.conversationalExtraction
    ? dependencies.conversationalExtractor ??
      (await (async () => {
        // Session extraction is the expensive model-backed half of the run and is
        // independent of recall-side flags, so the live extractor is always
        // wrapped in a content-addressed cache scoped to this run directory.
        const cachePath = join(runDirectory, LOCOMO_EXTRACTION_CACHE_FILE_NAME);
        let initialCache: Map<string, unknown> = new Map();
        try {
          initialCache = parseLocomoExtractionCacheLines(await readFileImpl(cachePath));
        } catch {
          // no cache yet
        }
        return wrapMemoryExtractorWithJsonlCache(
          createProviderConversationalMemoryExtractor({
            model: resolveLiveModelConfig("GOODMEMORY_EVAL"),
            requestTimeoutMs: LOCOMO_LIVE_REQUEST_TIMEOUT_MS,
          }),
          {
            appendFile: appendFileImpl,
            cachePath,
            configTag: process.env.GOODMEMORY_EVAL_MODEL ?? "eval-model",
            initialCache,
          },
        );
      })())
    : undefined;

  const results: LocomoQuestionRetrieval[] = [];
  const recordedQuestionKeys = new Set<string>();
  let executionFailures = 0;
  let checkpointWriteFailures = 0;
  let checkpointWriteTail = Promise.resolve();
  const pushResult = (result: LocomoQuestionRetrieval): void => {
    results.push(result);
    recordedQuestionKeys.add(
      locomoQuestionKey(result.caseId, result.questionId),
    );
  };
  const recordFailedResult = (
    testCase: LocomoCase,
    question: LocomoQuestion,
    failure: {
      message: string;
      stage: LocomoExecutionFailureStage;
    },
  ): void => {
    pushResult(
      withLocomoExecutionFailure(
        scoreLocomoRetrieval({
          question,
          retrievedTurnIds: [],
          testCase,
        }),
        failure,
      ),
    );
  };
  const replayCompletedForCase = (testCase: LocomoCase): void => {
    for (const question of testCase.questions) {
      const key = locomoQuestionKey(testCase.caseId, question.questionId);
      if (recordedQuestionKeys.has(key)) {
        continue;
      }
      const cached = completed.get(key);
      if (cached) {
        pushResult(rescoreCompletedLocomoResult(cached, question));
      }
    }
  };
  const recordProviderTimeoutRemainder = (
    startCaseIndex: number,
    error: LocomoProviderEmbeddingRunTimeoutError,
  ): void => {
    for (const remainingCase of cases.slice(startCaseIndex)) {
      replayCompletedForCase(remainingCase);
      for (const question of remainingCase.questions) {
        const key = locomoQuestionKey(
          remainingCase.caseId,
          question.questionId,
        );
        if (recordedQuestionKeys.has(key)) {
          continue;
        }
        executionFailures += 1;
        recordFailedResult(remainingCase, question, {
          message: error.message,
          stage: "provider-run-timeout",
        });
      }
    }
  };
  let providerTimedOut = false;
  const cueStats = { cuesApplied: 0, factsSeen: 0 };
  let liveCueGenerator:
    | NonNullable<LocomoSmokeDependencies["retrievalCueGenerator"]>
    | undefined;
  const cueInputKey = (input: {
    category: string;
    content: string;
    subject?: string;
  }): string => `${input.category} ${input.content} ${input.subject ?? ""}`;
  for (const [caseIndex, testCase] of cases.entries()) {
    try {
      assertProviderRunDeadline(`starting case ${testCase.caseId}`);
    } catch (error) {
      if (error instanceof LocomoProviderEmbeddingRunTimeoutError) {
        recordProviderTimeoutRemainder(caseIndex, error);
        providerTimedOut = true;
        break;
      }
      throw error;
    }
    const pendingQuestions = testCase.questions.filter(
      (question) =>
        !completed.has(locomoQuestionKey(testCase.caseId, question.questionId)),
    );
    if (pendingQuestions.length === 0) {
      // Everything in this case is checkpointed: skip seeding (and therefore
      // extraction) entirely.
      replayCompletedForCase(testCase);
      continue;
    }
    const memory = createMemory();
    const scope = buildLocomoScope({ caseId: testCase.caseId, runId });
    try {
      assertProviderRunDeadline(`seeding case ${testCase.caseId}`);
      // Always seed the raw dialogue turns. Conversational extraction is
      // ADDITIVE, never destructive: per arXiv 2605.12978 (lossy LLM rewriting
      // degrades utility), normalized atomic facts are stored ALONGSIDE the raw
      // turns as extra retrievable units, so a turn the extractor drops or
      // misphrases is still recoverable from its raw form. This mirrors the
      // product path, where assisted extraction merges with deterministic
      // extraction rather than replacing it.
      await seedLocomoCase({
        corefNormalize: options.corefNormalize,
        labelFreeIngest: options.labelFreeIngest,
        memory,
        runId,
        testCase,
      });
      if (conversationalExtractor) {
        assertProviderRunDeadline(
          `conversational extraction for case ${testCase.caseId}`,
        );
        await seedLocomoCaseConversational({
          extractor: conversationalExtractor,
          maxConcurrency: concurrency,
          memory,
          runId,
          smartFusion: options.smartFusion,
          testCase,
        });
      }
      if (cueDispatch) {
        const recorded: Array<{
          category: string;
          content: string;
          subject?: string;
        }> = [];
        cueDispatch.handler = async (input) => {
          recorded.push(input);
          return [];
        };
        await memory.runMaintenance({ jobs: ["retrievalCues"], scope });
        const generator =
          dependencies.retrievalCueGenerator ?? (liveCueGenerator ??= createProviderRetrievalCueGenerator({
            model: resolveLiveModelConfig("GOODMEMORY_EVAL"),
          }));
        const prefetched = new Map<string, string[]>();
        let cursor = 0;
        const prefetchWorker = async (): Promise<void> => {
          while (true) {
            const index = cursor;
            cursor += 1;
            const input = recorded[index];
            if (input === undefined) {
              return;
            }
            try {
              prefetched.set(cueInputKey(input), await generator.generate(input));
            } catch {
              // Per-fact tolerance: an unmapped input replays as no cues and
              // the fact stays uncovered, matching the job's failure posture.
            }
          }
        };
        await Promise.all(
          Array.from(
            {
              // Prefetch width follows the run's question concurrency so
              // production-scale backfills are not pinned to 4 workers.
              length: Math.max(
                1,
                Math.min(options.concurrency ?? 4, recorded.length),
              ),
            },
            () => prefetchWorker(),
          ),
        );
        cueDispatch.handler = async (input) =>
          prefetched.get(cueInputKey(input)) ?? [];
        const replay = await memory.runMaintenance({
          jobs: ["retrievalCues"],
          scope,
        });
        cueStats.factsSeen += recorded.length;
        cueStats.cuesApplied +=
          replay.maintenance?.jobs.find((job) => job.name === "retrievalCues")
            ?.applied ?? 0;
      }
      assertProviderRunDeadline(`seeding case ${testCase.caseId}`);
    } catch (error) {
      if (error instanceof LocomoProviderEmbeddingRunTimeoutError) {
        recordProviderTimeoutRemainder(caseIndex, error);
        providerTimedOut = true;
        break;
      }
      executionFailures += pendingQuestions.length;
      replayCompletedForCase(testCase);
      for (const question of pendingQuestions) {
        recordFailedResult(testCase, question, {
          message: errorMessage(error),
          stage: "seed",
        });
      }
      continue;
    }
    replayCompletedForCase(testCase);
    const recordResult = async (result: LocomoQuestionRetrieval): Promise<void> => {
      pushResult(result);
      if (!checkpointing) {
        return;
      }
      checkpointWriteTail = checkpointWriteTail
        .then(() => appendFileImpl(progressPath, `${JSON.stringify(result)}\n`))
        .catch(() => {
          // The checkpoint is an optimization: failing to persist it must never
          // fail the question. Surfaced once after the loop.
          checkpointWriteFailures += 1;
        });
      await checkpointWriteTail;
    };
    const processQuestion = async (question: LocomoQuestion): Promise<void> => {
      let retrieval: LocomoQuestionRetrieval | null = null;
      try {
        assertProviderRunDeadline(
          `recalling ${testCase.caseId}/${question.questionId}`,
        );
        const recall = await memory.recall({
          query: question.question,
          scope,
          strategy: recallStrategy,
          decompose: options.decompose,
          multiHop: options.multiHop,
        });
        assertProviderRunDeadline(
          `recalling ${testCase.caseId}/${question.questionId}`,
        );
        const retrievedTurnIds = options.answerFromPacket
          ? collectLocomoPacketTurnIds(recall)
          : collectLocomoRetrievedTurnIds(recall);
        retrieval = scoreLocomoRetrieval({
          question,
          retrievedTurnIds,
          testCase,
        });
        if (answerGenerator) {
          const generatedAnswer = await answerGenerator({
            memoryContext: options.answerFromRecalled
              ? buildLocomoRecalledContext({ recall })
              : options.answerFromPacket || options.evidencePack
                ? buildLocomoEvidencePackContext({
                    question,
                    retrievedTurnIds,
                    testCase,
                  })
                : buildLocomoAnswerContext({
                    retrievedTurnIds,
                    testCase,
                  }),
            question,
            retrievedTurnIds,
            testCase,
          });
          await recordResult({
            ...retrieval,
            answerCorrect: scoreLocomoAnswer({
              adversarialAnswer: question.adversarialAnswer,
              answer: generatedAnswer,
              goldAnswer: question.goldAnswer,
              matchMode: question.matchMode,
            }),
            answerTokenF1: locomoTokenF1(generatedAnswer, question.goldAnswer),
            generatedAnswer,
          });
        } else {
          await recordResult(retrieval);
        }
      } catch (error) {
        if (error instanceof LocomoProviderEmbeddingRunTimeoutError) {
          recordProviderTimeoutRemainder(caseIndex, error);
          providerTimedOut = true;
          return;
        }
        executionFailures += 1;
        if (retrieval) {
          pushResult(
            withLocomoExecutionFailure(retrieval, {
              message: errorMessage(error),
              stage: "answer",
            }),
          );
        } else {
          recordFailedResult(testCase, question, {
            message: errorMessage(error),
            stage: "recall",
          });
        }
      }
    };
    let pendingCursor = 0;
    const worker = async (): Promise<void> => {
      while (!providerTimedOut) {
        const question = pendingQuestions[pendingCursor];
        pendingCursor += 1;
        if (!question) {
          return;
        }
        await processQuestion(question);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, pendingQuestions.length) },
        () => worker(),
      ),
    );
    if (providerTimedOut) {
      break;
    }
  }
  await checkpointWriteTail;
  if (checkpointWriteFailures > 0) {
    process.stderr.write(
      `LoCoMo smoke: ${checkpointWriteFailures} checkpoint write(s) failed; ` +
        `--resume will recompute those questions.\n`,
    );
  }
  const resultOrder = new Map(
    cases
      .flatMap((testCase) =>
        testCase.questions.map((question) =>
          locomoQuestionKey(testCase.caseId, question.questionId),
        ),
      )
      .map((key, index) => [key, index] as const),
  );
  results.sort(
    (left, right) =>
      (resultOrder.get(locomoQuestionKey(left.caseId, left.questionId)) ?? 0) -
      (resultOrder.get(locomoQuestionKey(right.caseId, right.questionId)) ?? 0),
  );
  const report: LocomoSmokeReport = {
    allowCommonsenseResolution: options.allowCommonsenseResolution ?? false,
    strictNoEvidenceAbstention: options.strictNoEvidenceAbstention ?? false,
    answerContextMode,
    answerEvaluation: liveAnswer ? "scored" : "deferred-to-live-mode",
    benchmark: "locomo",
    benchmarkFingerprint,
    benchmarkSource,
    bm25Ranking: options.bm25 ?? false,
    generalizedFusion: options.generalizedFusion ?? false,
    generalizedFusionConfig: locomoGeneralizedFusionConfig(
      options.generalizedFusion ?? false,
      options.fusionMinRelativeStrength,
      options.entityPageRank,
    ),
    caseIds: cases.map((testCase) => testCase.caseId),
    caseCount: cases.length,
    cases: results,
    categories: summarizeLocomoRetrieval(results),
    concurrency,
    executionFailures,
    externalRoot: options.benchmarkRoot ?? null,
    generatedAt: now().toISOString(),
    generatedBy: GENERATED_BY,
    ingestMode: conversationalExtractor
      ? "conversational-extraction"
      : "raw-turns",
    labelFreeIngest: options.labelFreeIngest ?? false,
    license: UPSTREAM_LICENSE,
    mode: liveAnswer ? "live-answer" : "retrieval-only",
    ...(options.retrievalCues ? { retrievalCues: cueStats } : {}),
    phase: "phase-65",
    profilesCompared: options.generalizedFusion
      ? ["goodmemory-recommended"]
      : [...PROFILES_COMPARED],
    providerEmbeddingRunTimeoutMs:
      resolvedOptions.providerEmbeddingRunTimeoutMs ?? null,
    providerEmbeddingTimeoutMs: resolvedOptions.providerEmbeddingTimeoutMs ?? null,
    providerReranking: options.providerReranking ?? false,
    providerRerankingTimeoutMs:
      resolvedOptions.providerRerankingTimeoutMs ?? null,
    questionCount: results.length,
    questionCategories: resolvedOptions.questionCategories ?? null,
    questionIds: resolvedOptions.questionIds ?? null,
    questionSelection: buildLocomoQuestionSelection(options),
    resume: options.resume ?? false,
    retrievalConfig: {
      bm25Ranking: options.bm25 ?? false,
      corefNormalize: options.corefNormalize ?? false,
      decompose: options.decompose ?? false,
      generalizedFusion: options.generalizedFusion ?? false,
      labelFreeIngest: options.labelFreeIngest ?? false,
      multiHop: options.multiHop ?? false,
      providerEmbedding: options.providerEmbedding ?? false,
      providerReranking: options.providerReranking ?? false,
      rerank: options.rerank ?? false,
      smartFusion: options.smartFusion ?? false,
    },
    rerankGeneralizedFusionConfig: locomoRerankGeneralizedFusionConfig(
      (options.generalizedFusion ?? false) &&
        (options.providerReranking ?? false),
    ),
    runDirectory,
    runId,
    semanticCandidateEmbeddingSource,
    semanticCandidates,
    upstreamAnswerMetricByCategory: deriveLocomoUpstreamMetricByCategory(cases),
    upstreamSource: UPSTREAM_SOURCE,
  };

  await mkdirImpl(runDirectory, { recursive: true });
  await writeFileImpl(
    join(runDirectory, LOCOMO_SMOKE_REPORT_FILE_NAME),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

function buildCliSummary(report: LocomoSmokeReport): {
  benchmarkSource: string;
  caseIds: string[];
  categories: LocomoCategoryRetrievalSummary[];
  executionFailures: number;
  providerEmbeddingRunTimeoutMs: number | null;
  providerEmbeddingTimeoutMs: number | null;
  questionCount: number;
  questionCategories: LocomoSmokeReport["questionCategories"];
  reportPath: string;
  runId: string;
  semanticCandidateEmbeddingSource: LocomoSmokeReport["semanticCandidateEmbeddingSource"];
  semanticCandidates: LocomoSmokeReport["semanticCandidates"];
} {
  return {
    benchmarkSource: report.benchmarkSource,
    caseIds: report.caseIds,
    categories: report.categories,
    executionFailures: report.executionFailures,
    providerEmbeddingRunTimeoutMs:
      report.providerEmbeddingRunTimeoutMs ?? null,
    providerEmbeddingTimeoutMs: report.providerEmbeddingTimeoutMs ?? null,
    questionCount: report.questionCount,
    questionCategories: report.questionCategories,
    reportPath: join(report.runDirectory, LOCOMO_SMOKE_REPORT_FILE_NAME),
    runId: report.runId,
    semanticCandidateEmbeddingSource: report.semanticCandidateEmbeddingSource,
    semanticCandidates: report.semanticCandidates,
  };
}

if (import.meta.main) {
  const options = parseLocomoSmokeCliOptions(process.argv);
  runLocomoSmoke(options)
    .then((report) => {
      process.stdout.write(
        `${JSON.stringify(buildCliSummary(report), null, 2)}\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(`LoCoMo smoke run failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
