// Phase 64 MemoryAgentBench external-root preparation.
//
// Mirrors scripts/prepare-phase-63-beam-data.ts: it fetches one upstream row
// from the Hugging Face `ai-hyz/MemoryAgentBench` dataset (MIT) via the
// datasets-server rows endpoint and writes an ALREADY-NORMALIZED cases.json into
// the external root (GOODMEMORY_MAB_ROOT / --output-root, default /private/tmp/MAB).
// No upstream data is vendored into the repo; only this normalizer and its test
// live here. The output is the exact MemoryAgentBenchCase contract the Phase 64
// smoke adapter (scripts/run-phase-64-memory-agent-bench-smoke.ts) consumes.
//
// The recurring Phase 64 friction was that the external root was hand-normalized
// and lost whenever /private/tmp/MAB was cleared. This makes the per-competency
// external root reproducible and deterministic (no LLM).
//
// Competencies map to upstream splits:
//   AR  -> Accurate_Retrieval        (implemented: event_qa rows, see below)
//   CR  -> Conflict_Resolution       (implemented: factconsolidation single-hop, see below)
//   TTL -> Test_Time_Learning        (follow-up)
//   LRU -> Long_Range_Understanding  (follow-up)
//
// CR / factconsolidation single-hop normalization: the upstream row's context is
// "Here is a list of facts: 0. <fact> 1. <fact> ...". Each numbered fact is a
// chunk (chunk id == fact number + 1; content keeps the "N. " prefix). The
// conflict-resolution task asks for the current consolidated value, and the gold
// answer string appears in the fact(s) that state it. Gold evidence is therefore
// the chunk(s) whose text contains the gold answer -- BUT only when that count is
// small (<= --max-evidence-facts, default 3). Rare-valued answers (e.g.
// "pesäpallo") land in 1-3 facts (the genuine consolidation chain); common-string
// answers recur across many unrelated facts, where substring evidence is trivially
// noisy (the same invalid-signal class avoided for AR ruler_qa). Questions over the
// recurrence threshold are DROPPED with a logged count, not silently kept. Every
// fact is still injected as a chunk (the full distractor set); staleChunkIds is
// left empty because identifying the superseded value reliably needs subject
// extraction, a separate follow-up.
//
// AR / event_qa normalization (the one with a fully STRUCTURAL gold-evidence
// derivation, so no fragile substring guessing): the upstream row carries
// `metadata.previous_events` (cumulative numbered event lists) and `answers`
// (the correct next event per question). The event sequence is therefore
// event 1 = previous_events[0] and event (i+2) = answers[i][0]. We make each
// event a retrievable chunk (chunk id == event number) and set question i's
// gold evidence to the next-event chunk (id i+2) by construction. This matches
// the upstream EventQA ordering task and gives a meaningful retrieval signal
// (the multiple-choice query dilutes token overlap, so recall measures top-K
// ranking quality, not a trivial lookup). ruler_qa rows are intentionally NOT
// used for AR: their natural-language answers (e.g. "France") recur across dozens
// of documents, so substring-derived evidence would be trivially noisy.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  asyncBufferFromFile,
  parquetReadObjects,
} from "hyparquet";
import {
  hasCliFlagStrict,
  resolveCliFlagValueStrict,
  resolveEnvValueStrict,
} from "./cli-options";
import { normalizeMemoryAgentBenchAnswer } from "../src/eval/memoryAgentBench";
import type {
  MemoryAgentBenchCase,
  MemoryAgentBenchChunk,
  MemoryAgentBenchCompetency,
  MemoryAgentBenchQuestion,
} from "../src/eval/memoryAgentBench";

// Derive CR evidence with the SAME normalization the smoke uses to score
// substring_exact_match, so a fact that counts as evidence is one the scorer
// would also accept.
const normalizeMatch = normalizeMemoryAgentBenchAnswer;

export const MEMORY_AGENT_BENCH_DATASET = "ai-hyz/MemoryAgentBench";
export const MEMORY_AGENT_BENCH_UPSTREAM_SOURCE =
  "https://github.com/HUST-AI-HYZ/MemoryAgentBench";
export const MEMORY_AGENT_BENCH_UPSTREAM_LICENSE = "MIT";
export const MEMORY_AGENT_BENCH_CASES_FILE_NAME = "cases.json";
export const MEMORY_AGENT_BENCH_METADATA_FILE_NAME =
  "phase-64-mab-export-metadata.json";
const DEFAULT_OUTPUT_ROOT = "/private/tmp/MAB";

// Competency -> upstream datasets-server split (config "default").
export const MEMORY_AGENT_BENCH_COMPETENCY_SPLITS: Record<
  MemoryAgentBenchCompetency,
  string
> = {
  AR: "Accurate_Retrieval",
  TTL: "Test_Time_Learning",
  LRU: "Long_Range_Understanding",
  CR: "Conflict_Resolution",
};

// Default upstream row per competency: the row index whose sub-dataset has an
// implemented normalizer. AR row 5 is `eventqa_full`.
const DEFAULT_OFFSET_BY_COMPETENCY: Record<MemoryAgentBenchCompetency, number> = {
  AR: 5,
  CR: 4,
  TTL: 1,
  LRU: 100,
};

// LRU detective_qa: fixed-size story chunk window (chars). The story is long
// (hundreds of KB); windows give retrievable passages without per-paragraph noise.
const DETECTIVE_QA_CHUNK_SIZE = 2000;

// CR only: drop a question whose gold answer appears in more than this many facts
// (common-string recurrence => noisy evidence). Ignored by other competencies.
const DEFAULT_MAX_EVIDENCE_FACTS = 3;

export interface Phase64MabPrepareOptions {
  competency: MemoryAgentBenchCompetency;
  dataset: string;
  // TTL only: cap the number of injected ICL demos (the upstream rows ship
  // thousands; null keeps them all). Bounds seed cost for the live-answer slice.
  maxChunks: number | null;
  // CR only: max facts a gold answer may appear in before the question is dropped.
  maxEvidenceFacts: number;
  // null = keep every question in the row.
  maxQuestions: number | null;
  // When true, retain existing cases of OTHER competencies in cases.json and
  // replace only this competency's cases. When false, overwrite cases.json.
  merge: boolean;
  offset: number;
  outputRoot: string;
  parquetFile?: string;
}

export interface Phase64MabPrepareResult {
  caseId: string;
  casesFile: string;
  chunkCount: number;
  competency: MemoryAgentBenchCompetency;
  dataset: string;
  // Questions skipped during normalization (CR recurrence filter); 0 otherwise.
  droppedQuestions: number;
  generatedAt: string;
  merged: boolean;
  metadataFile: string;
  offset: number;
  outputRoot: string;
  questionCount: number;
  rowsEndpoint: string;
  sourceDataset: string;
  split: string;
  totalCasesWritten: number;
  totalQuestionsAvailable: number;
}

export interface Phase64MabPrepareDependencies {
  mkdir?: typeof mkdir;
  now?: () => Date;
  readFile?: (path: string) => Promise<string>;
  readParquetObjects?: (path: string) => Promise<Record<string, unknown>[]>;
  requestJson?: (url: string) => Promise<unknown>;
  writeFile?: (path: string, value: string) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCompetency(value: string | undefined): MemoryAgentBenchCompetency {
  if (!value) {
    return "AR";
  }
  if (value === "AR" || value === "TTL" || value === "LRU" || value === "CR") {
    return value;
  }
  throw new Error("--competency must be one of AR, TTL, LRU, CR");
}

function parseNonNegativeInteger(
  value: string | undefined,
  fallback: number,
  flagName: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a non-negative integer`);
  }
  return parsed;
}

function parseMaxQuestions(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  // 0 (or any non-positive) means "no cap" so callers can opt into the full row.
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("--max-questions must be a non-negative integer (0 = all)");
  }
  return parsed === 0 ? null : parsed;
}

export function parsePhase64MabPrepareCliOptions(
  argv: readonly string[],
): Phase64MabPrepareOptions {
  const competency = parseCompetency(
    resolveCliFlagValueStrict(argv, "--competency"),
  );
  return {
    competency,
    dataset:
      resolveCliFlagValueStrict(argv, "--dataset") ??
      MEMORY_AGENT_BENCH_DATASET,
    maxChunks: parseMaxQuestions(
      resolveCliFlagValueStrict(argv, "--max-chunks"),
    ),
    maxEvidenceFacts: parseNonNegativeInteger(
      resolveCliFlagValueStrict(argv, "--max-evidence-facts"),
      DEFAULT_MAX_EVIDENCE_FACTS,
      "--max-evidence-facts",
    ),
    maxQuestions: parseMaxQuestions(
      resolveCliFlagValueStrict(argv, "--max-questions"),
    ),
    merge: hasCliFlagStrict(argv, "--merge"),
    offset: parseNonNegativeInteger(
      resolveCliFlagValueStrict(argv, "--offset"),
      DEFAULT_OFFSET_BY_COMPETENCY[competency],
      "--offset",
    ),
    outputRoot:
      resolveCliFlagValueStrict(argv, "--output-root") ??
      resolveEnvValueStrict(process.env, "GOODMEMORY_MAB_ROOT") ??
      DEFAULT_OUTPUT_ROOT,
    ...(resolveCliFlagValueStrict(argv, "--parquet-file") === undefined
      ? {}
      : {
          parquetFile: resolveCliFlagValueStrict(argv, "--parquet-file"),
        }),
  };
}

export function buildPhase64MabRowsUrl(input: {
  dataset: string;
  length: number;
  offset: number;
  split: string;
}): string {
  const params = new URLSearchParams({
    dataset: input.dataset,
    config: "default",
    split: input.split,
    offset: String(input.offset),
    length: String(input.length),
  });
  return `https://datasets-server.huggingface.co/rows?${params.toString()}`;
}

export function buildPhase64MabCurlRequestCommand(url: string): string[] {
  return [
    "curl",
    "-sS",
    "-L",
    "--retry",
    "4",
    "--retry-delay",
    "1",
    "--retry-all-errors",
    "--connect-timeout",
    "20",
    "--max-time",
    "180",
    url,
  ];
}

async function requestJsonWithCurl(url: string): Promise<unknown> {
  const proc = Bun.spawn(buildPhase64MabCurlRequestCommand(url), {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`curl failed for MemoryAgentBench request: ${stderr.trim()}`);
  }
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `MemoryAgentBench request did not return valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function readLocalParquetObjects(
  path: string,
): Promise<Record<string, unknown>[]> {
  const file = await asyncBufferFromFile(path);
  return parquetReadObjects({ file });
}

interface UpstreamRow {
  row: Record<string, unknown>;
  truncatedCells: string[];
}

function readSingleUpstreamRow(value: unknown): UpstreamRow {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    throw new Error("MemoryAgentBench rows response must include a rows array");
  }
  if (value.rows.length === 0) {
    throw new Error(
      "MemoryAgentBench rows response is empty (offset out of range?)",
    );
  }
  const entry = value.rows[0];
  if (!isRecord(entry) || !isRecord(entry.row)) {
    throw new Error("MemoryAgentBench rows[0] must be an object with a row object");
  }
  const truncatedCells = Array.isArray(entry.truncated_cells)
    ? entry.truncated_cells.filter((cell): cell is string => typeof cell === "string")
    : [];
  return { row: entry.row, truncatedCells };
}

function assertConsumedCellsIntact(
  truncatedCells: readonly string[],
  consumed: readonly string[],
): void {
  const hit = consumed.filter((cell) => truncatedCells.includes(cell));
  if (hit.length > 0) {
    throw new Error(
      `MemoryAgentBench row truncated the consumed cell(s): ${hit.join(", ")}; refusing incomplete export`,
    );
  }
}

function asStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`MemoryAgentBench row field "${name}" must be an array`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(
        `MemoryAgentBench row field "${name}[${index}]" must be a string`,
      );
    }
    return entry;
  });
}

// answers is an array of acceptable-answer lists (e.g. [["France","France"]]);
// the first entry is the canonical gold answer. Tolerates a bare string entry.
function firstGoldAnswer(value: unknown, index: number): string {
  const entry = Array.isArray(value) ? value[index] : undefined;
  if (typeof entry === "string") {
    return entry;
  }
  if (Array.isArray(entry) && typeof entry[0] === "string") {
    return entry[0];
  }
  throw new Error(
    `MemoryAgentBench row "answers[${index}]" must be a string or string[]`,
  );
}

function stripLeadingEventNumber(value: string): string {
  return value.replace(/^\s*\d+\.\s*/u, "").trim();
}

// Accurate_Retrieval / event_qa normalizer (see module header).
function normalizeEventQaRow(
  row: Record<string, unknown>,
  truncatedCells: readonly string[],
  options: Phase64MabPrepareOptions,
): MemoryAgentBenchCase {
  assertConsumedCellsIntact(truncatedCells, ["questions", "answers", "metadata"]);
  const metadata = isRecord(row.metadata) ? row.metadata : undefined;
  if (!metadata) {
    throw new Error("MemoryAgentBench event_qa row must include a metadata object");
  }
  const previousEvents = asStringArray(
    metadata.previous_events,
    "metadata.previous_events",
  );
  if (previousEvents.length === 0) {
    throw new Error(
      "MemoryAgentBench event_qa row must include a non-empty previous_events list",
    );
  }
  const questions = asStringArray(row.questions, "questions");
  const qaPairIds = asStringArray(metadata.qa_pair_ids, "metadata.qa_pair_ids");
  if (!Array.isArray(row.answers)) {
    throw new Error('MemoryAgentBench row field "answers" must be an array');
  }
  const sourceDataset =
    typeof metadata.source === "string" && metadata.source.length > 0
      ? metadata.source
      : "event_qa";

  const available = Math.min(
    row.answers.length,
    questions.length,
    qaPairIds.length,
  );
  const limit =
    options.maxQuestions === null
      ? available
      : Math.min(options.maxQuestions, available);
  if (limit === 0) {
    throw new Error(
      "MemoryAgentBench event_qa row produced no questions (empty answers/questions)",
    );
  }

  // event 1 (the seed event) plus events 2..(limit+1) (the gold next events).
  const chunks: MemoryAgentBenchChunk[] = [
    { content: stripLeadingEventNumber(previousEvents[0]), id: 1, role: "user" },
  ];
  const normalizedQuestions: MemoryAgentBenchQuestion[] = [];
  for (let index = 0; index < limit; index += 1) {
    const goldAnswer = firstGoldAnswer(row.answers, index);
    const eventChunkId = index + 2;
    chunks.push({ content: goldAnswer, id: eventChunkId, role: "user" });
    normalizedQuestions.push({
      competency: "AR",
      evidenceChunkIds: [eventChunkId],
      goldAnswer,
      matchMode: "substring_exact_match",
      question: questions[index],
      questionId: qaPairIds[index] ?? `${sourceDataset}_no${index}`,
      staleChunkIds: [],
    });
  }

  return {
    caseId: `ar_${sourceDataset}`,
    chunks,
    competency: "AR",
    questions: normalizedQuestions,
    sourceDataset,
  };
}

// Parse the CR "Here is a list of facts: 0. <fact> 1. <fact> ..." context into
// ordered numbered facts. The fact number is taken verbatim; chunk id is fact
// number + 1 (so chunk id 1 == fact 0), matching the smoke's 1-based chunk ids.
function parseNumberedFacts(context: string): Array<{ content: string; number: number }> {
  const matches = [
    ...context.matchAll(/(?:^|\s)(\d+)\.\s+([\s\S]*?)(?=\s+\d+\.\s|\s*$)/gu),
  ];
  return matches.map((match) => ({
    content: `${match[1]}. ${match[2].trim()}`,
    number: Number(match[1]),
  }));
}

// CR / factconsolidation single-hop normalizer (see module header).
function normalizeFactConsolidationRow(
  row: Record<string, unknown>,
  truncatedCells: readonly string[],
  options: Phase64MabPrepareOptions,
): { case: MemoryAgentBenchCase; droppedQuestions: number } {
  assertConsumedCellsIntact(truncatedCells, ["context", "questions", "answers", "metadata"]);
  if (typeof row.context !== "string") {
    throw new Error('MemoryAgentBench factconsolidation row "context" must be a string');
  }
  const metadata = isRecord(row.metadata) ? row.metadata : undefined;
  if (!metadata) {
    throw new Error(
      "MemoryAgentBench factconsolidation row must include a metadata object",
    );
  }
  const questions = asStringArray(row.questions, "questions");
  const qaPairIds = asStringArray(metadata.qa_pair_ids, "metadata.qa_pair_ids");
  if (!Array.isArray(row.answers)) {
    throw new Error('MemoryAgentBench row field "answers" must be an array');
  }
  const sourceDataset =
    typeof metadata.source === "string" && metadata.source.length > 0
      ? metadata.source
      : "fact_consolidation_sh";

  const facts = parseNumberedFacts(row.context);
  if (facts.length === 0) {
    throw new Error(
      "MemoryAgentBench factconsolidation row produced no numbered facts",
    );
  }
  const chunks: MemoryAgentBenchChunk[] = facts.map((fact) => ({
    content: fact.content,
    id: fact.number + 1,
    role: "user",
  }));
  const normalizedFacts = facts.map((fact) => ({
    chunkId: fact.number + 1,
    normalized: normalizeMatch(fact.content),
  }));

  const available = Math.min(row.answers.length, questions.length, qaPairIds.length);
  const normalizedQuestions: MemoryAgentBenchQuestion[] = [];
  let droppedQuestions = 0;
  for (let index = 0; index < available; index += 1) {
    if (
      options.maxQuestions !== null &&
      normalizedQuestions.length >= options.maxQuestions
    ) {
      break;
    }
    const goldAnswer = firstGoldAnswer(row.answers, index);
    const goldNormalized = normalizeMatch(goldAnswer);
    if (goldNormalized.length === 0) {
      droppedQuestions += 1;
      continue;
    }
    const evidenceChunkIds = normalizedFacts
      .filter((fact) => fact.normalized.includes(goldNormalized))
      .map((fact) => fact.chunkId);
    // Keep only low-recurrence answers: 1..maxEvidenceFacts facts is the genuine
    // consolidation chain; more is common-string noise (drop it).
    if (
      evidenceChunkIds.length === 0 ||
      evidenceChunkIds.length > options.maxEvidenceFacts
    ) {
      droppedQuestions += 1;
      continue;
    }
    normalizedQuestions.push({
      competency: "CR",
      evidenceChunkIds,
      goldAnswer,
      matchMode: "substring_exact_match",
      question: questions[index],
      questionId: qaPairIds[index] ?? `${sourceDataset}_no${index}`,
      staleChunkIds: [],
    });
  }
  if (normalizedQuestions.length === 0) {
    throw new Error(
      "MemoryAgentBench factconsolidation row produced no questions with low-recurrence evidence",
    );
  }

  return {
    case: {
      caseId: `cr_${sourceDataset}`,
      chunks,
      competency: "CR",
      questions: normalizedQuestions,
      sourceDataset,
    },
    droppedQuestions,
  };
}

// TTL / ICL (in-context learning, e.g. banking77) ANSWER-EVAL normalizer. Each
// upstream demo "<utterance>\nlabel: <id>" becomes a chunk so retrieving it
// teaches the utterance->label mapping; the question is a new utterance and the
// gold answer is its label id (exact_match). Retrieval recall is intentionally
// NOT the metric (a gold label has dozens of demos); this case exists for the
// live-answer path, which tests whether the test-time-learned policy can be
// applied at answer time. evidenceChunkIds points at the same-label demos for the
// diagnostic only. --max-chunks bounds the (thousands of) injected demos.
function normalizeIclRow(
  row: Record<string, unknown>,
  truncatedCells: readonly string[],
  options: Phase64MabPrepareOptions,
): { case: MemoryAgentBenchCase; droppedQuestions: number } {
  assertConsumedCellsIntact(truncatedCells, ["context", "questions", "answers", "metadata"]);
  if (typeof row.context !== "string") {
    throw new Error('MemoryAgentBench TTL/ICL row "context" must be a string');
  }
  const metadata = isRecord(row.metadata) ? row.metadata : undefined;
  if (!metadata) {
    throw new Error("MemoryAgentBench TTL/ICL row must include a metadata object");
  }
  const questions = asStringArray(row.questions, "questions");
  const qaPairIds = asStringArray(metadata.qa_pair_ids, "metadata.qa_pair_ids");
  if (!Array.isArray(row.answers)) {
    throw new Error('MemoryAgentBench row field "answers" must be an array');
  }
  const sourceDataset =
    typeof metadata.source === "string" && metadata.source.length > 0
      ? metadata.source
      : "icl";

  const rawDemos = row.context
    .split(/\n\s*\n+/u)
    .map((demo) => demo.trim())
    .filter((demo) => demo.length > 0);
  const demoLimit =
    options.maxChunks === null
      ? rawDemos.length
      : Math.min(options.maxChunks, rawDemos.length);
  const chunks: MemoryAgentBenchChunk[] = [];
  const labelToChunkIds = new Map<string, number[]>();
  for (let index = 0; index < demoLimit; index += 1) {
    const demo = rawDemos[index];
    const labelMatch = /label:\s*(\S+)\s*$/u.exec(demo);
    if (!labelMatch) {
      continue;
    }
    const chunkId = chunks.length + 1;
    chunks.push({ content: demo, id: chunkId, role: "user" });
    const label = labelMatch[1];
    const ids = labelToChunkIds.get(label) ?? [];
    ids.push(chunkId);
    labelToChunkIds.set(label, ids);
  }
  if (chunks.length === 0) {
    throw new Error("MemoryAgentBench TTL/ICL row produced no labeled demos");
  }

  const available = Math.min(row.answers.length, questions.length, qaPairIds.length);
  const normalizedQuestions: MemoryAgentBenchQuestion[] = [];
  let droppedQuestions = 0;
  for (let index = 0; index < available; index += 1) {
    if (
      options.maxQuestions !== null &&
      normalizedQuestions.length >= options.maxQuestions
    ) {
      break;
    }
    const goldAnswer = firstGoldAnswer(row.answers, index);
    const evidenceChunkIds = labelToChunkIds.get(goldAnswer.trim()) ?? [];
    // Drop a question whose gold label has no demo in the injected set: it cannot
    // be learned in-context, so it would only measure the missing demo, not policy.
    if (evidenceChunkIds.length === 0) {
      droppedQuestions += 1;
      continue;
    }
    normalizedQuestions.push({
      competency: "TTL",
      evidenceChunkIds,
      goldAnswer,
      matchMode: "exact_match",
      question: questions[index],
      questionId: qaPairIds[index] ?? `${sourceDataset}_no${index}`,
      staleChunkIds: [],
    });
  }
  if (normalizedQuestions.length === 0) {
    throw new Error(
      "MemoryAgentBench TTL/ICL row produced no questions whose gold label has an injected demo",
    );
  }

  return {
    case: {
      caseId: `ttl_${sourceDataset}`,
      chunks,
      competency: "TTL",
      questions: normalizedQuestions,
      sourceDataset,
    },
    droppedQuestions,
  };
}

// LRU / detective_qa ANSWER-EVAL normalizer. The story (row.context) is chunked
// into fixed-size windows; each question is a multiple-choice whodunit whose
// options and an "Output:" cue are already in the question text, and the gold is
// the full chosen option (e.g. "C. The Brandt couple") scored by exact_match.
// Answering needs whole-story reasoning, so retrieval recall is NOT the metric;
// evidenceChunkIds points at story windows mentioning the answer entity for the
// diagnostic only. This case exists for the live-answer path.
function normalizeDetectiveQaRow(
  row: Record<string, unknown>,
  truncatedCells: readonly string[],
  options: Phase64MabPrepareOptions,
): { case: MemoryAgentBenchCase; droppedQuestions: number } {
  assertConsumedCellsIntact(truncatedCells, ["context", "questions", "answers", "metadata"]);
  if (typeof row.context !== "string") {
    throw new Error('MemoryAgentBench LRU row "context" must be a string');
  }
  const metadata = isRecord(row.metadata) ? row.metadata : undefined;
  if (!metadata) {
    throw new Error("MemoryAgentBench LRU row must include a metadata object");
  }
  const questions = asStringArray(row.questions, "questions");
  const qaPairIds = asStringArray(metadata.qa_pair_ids, "metadata.qa_pair_ids");
  if (!Array.isArray(row.answers)) {
    throw new Error('MemoryAgentBench row field "answers" must be an array');
  }
  const sourceDataset =
    typeof metadata.source === "string" && metadata.source.length > 0
      ? metadata.source
      : "detective_qa";

  const story = row.context;
  const chunks: MemoryAgentBenchChunk[] = [];
  for (let offset = 0; offset < story.length; offset += DETECTIVE_QA_CHUNK_SIZE) {
    const content = story.slice(offset, offset + DETECTIVE_QA_CHUNK_SIZE).trim();
    if (content.length > 0) {
      chunks.push({ content, id: chunks.length + 1, role: "user" });
    }
  }
  const chunkLimit =
    options.maxChunks === null ? chunks.length : Math.min(options.maxChunks, chunks.length);
  const injectedChunks = chunks.slice(0, chunkLimit);
  if (injectedChunks.length === 0) {
    throw new Error("MemoryAgentBench LRU row produced no story chunks");
  }
  const normalizedChunks = injectedChunks.map((chunk) => ({
    chunkId: chunk.id,
    normalized: normalizeMatch(chunk.content),
  }));

  const available = Math.min(row.answers.length, questions.length, qaPairIds.length);
  const normalizedQuestions: MemoryAgentBenchQuestion[] = [];
  for (let index = 0; index < available; index += 1) {
    if (
      options.maxQuestions !== null &&
      normalizedQuestions.length >= options.maxQuestions
    ) {
      break;
    }
    const goldAnswer = firstGoldAnswer(row.answers, index);
    // Evidence = story windows mentioning the answer entity (option letter stripped).
    const entity = normalizeMatch(goldAnswer.replace(/^\s*[A-D][.)]\s*/u, ""));
    const evidenceChunkIds =
      entity.length > 0
        ? normalizedChunks
            .filter((chunk) => chunk.normalized.includes(entity))
            .map((chunk) => chunk.chunkId)
        : [];
    normalizedQuestions.push({
      competency: "LRU",
      evidenceChunkIds,
      goldAnswer,
      matchMode: "exact_match",
      question: questions[index],
      questionId: qaPairIds[index] ?? `${sourceDataset}_no${index}`,
      staleChunkIds: [],
    });
  }
  if (normalizedQuestions.length === 0) {
    throw new Error("MemoryAgentBench LRU row produced no questions");
  }

  return {
    case: {
      caseId: `lru_${sourceDataset}`,
      chunks: injectedChunks,
      competency: "LRU",
      questions: normalizedQuestions,
      sourceDataset,
    },
    droppedQuestions: 0,
  };
}

function normalizeRowToCase(
  competency: MemoryAgentBenchCompetency,
  row: Record<string, unknown>,
  truncatedCells: readonly string[],
  options: Phase64MabPrepareOptions,
): { case: MemoryAgentBenchCase; droppedQuestions: number } {
  if (competency === "AR") {
    return {
      case: normalizeEventQaRow(row, truncatedCells, options),
      droppedQuestions: 0,
    };
  }
  if (competency === "CR") {
    return normalizeFactConsolidationRow(row, truncatedCells, options);
  }
  if (competency === "TTL") {
    return normalizeIclRow(row, truncatedCells, options);
  }
  if (competency === "LRU") {
    return normalizeDetectiveQaRow(row, truncatedCells, options);
  }
  throw new Error(
    `MemoryAgentBench prep: unsupported competency ${competency}. Expected AR, CR, TTL, or LRU.`,
  );
}

async function loadExistingCases(
  casesFile: string,
  readFileImpl: (path: string) => Promise<string>,
): Promise<MemoryAgentBenchCase[]> {
  let raw: string;
  try {
    raw = await readFileImpl(casesFile);
  } catch {
    // Absent file: nothing to merge into.
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Existing MemoryAgentBench cases file ${casesFile} is not valid JSON; refusing to overwrite: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const cases = isRecord(parsed) ? parsed.cases : parsed;
  if (!Array.isArray(cases)) {
    throw new Error(
      `Existing MemoryAgentBench cases file ${casesFile} must contain a cases array (or {cases: [...]}).`,
    );
  }
  return cases as MemoryAgentBenchCase[];
}

export async function preparePhase64MemoryAgentBenchData(
  options: Phase64MabPrepareOptions,
  dependencies: Phase64MabPrepareDependencies = {},
): Promise<Phase64MabPrepareResult> {
  const mkdirImpl = dependencies.mkdir ?? mkdir;
  const writeFileImpl = dependencies.writeFile ?? writeFile;
  const readFileImpl =
    dependencies.readFile ?? ((path: string) => readFile(path, "utf8"));
  const requestJson = dependencies.requestJson ?? requestJsonWithCurl;
  const readParquetObjects =
    dependencies.readParquetObjects ?? readLocalParquetObjects;
  const now = dependencies.now ?? (() => new Date());

  const split = MEMORY_AGENT_BENCH_COMPETENCY_SPLITS[options.competency];
  const rowsEndpoint = options.parquetFile === undefined
    ? buildPhase64MabRowsUrl({
        dataset: options.dataset,
        length: 1,
        offset: options.offset,
        split,
      })
    : `${pathToFileURL(options.parquetFile).href}#row=${options.offset}`;
  const upstream = options.parquetFile === undefined
    ? readSingleUpstreamRow(await requestJson(rowsEndpoint))
    : readSingleUpstreamRow({
        rows: [{
          row: (await readParquetObjects(options.parquetFile))[options.offset],
          row_idx: options.offset,
          truncated_cells: [],
        }],
      });
  const { row, truncatedCells } = upstream;
  const totalQuestionsAvailable = Array.isArray(row.questions)
    ? row.questions.length
    : 0;
  const { case: normalizedCase, droppedQuestions } = normalizeRowToCase(
    options.competency,
    row,
    truncatedCells,
    options,
  );

  const casesFile = join(options.outputRoot, MEMORY_AGENT_BENCH_CASES_FILE_NAME);
  const metadataFile = join(
    options.outputRoot,
    MEMORY_AGENT_BENCH_METADATA_FILE_NAME,
  );
  const retained = options.merge
    ? (await loadExistingCases(casesFile, readFileImpl)).filter(
        (existing) => existing.competency !== options.competency,
      )
    : [];
  const cases = [...retained, normalizedCase];

  const generatedAt = now().toISOString();
  const result: Phase64MabPrepareResult = {
    caseId: normalizedCase.caseId,
    casesFile,
    chunkCount: normalizedCase.chunks.length,
    competency: options.competency,
    dataset: options.dataset,
    droppedQuestions,
    generatedAt,
    merged: options.merge,
    metadataFile,
    offset: options.offset,
    outputRoot: options.outputRoot,
    questionCount: normalizedCase.questions.length,
    rowsEndpoint,
    sourceDataset: normalizedCase.sourceDataset,
    split,
    totalCasesWritten: cases.length,
    totalQuestionsAvailable,
  };

  await mkdirImpl(options.outputRoot, { recursive: true });
  await writeFileImpl(casesFile, `${JSON.stringify({ cases }, null, 2)}\n`);
  await writeFileImpl(
    metadataFile,
    `${JSON.stringify(
      {
        ...result,
        upstreamLicense: MEMORY_AGENT_BENCH_UPSTREAM_LICENSE,
        upstreamSource: MEMORY_AGENT_BENCH_UPSTREAM_SOURCE,
      },
      null,
      2,
    )}\n`,
  );
  return result;
}

if (import.meta.main) {
  const result = await preparePhase64MemoryAgentBenchData(
    parsePhase64MabPrepareCliOptions(Bun.argv),
  );
  console.log(JSON.stringify(result, null, 2));
}
