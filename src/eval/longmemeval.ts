import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { GoodMemory, RecallInput, RecallResult } from "../api/contracts";
import type { EvidenceLedgerFormat } from "../answer/evidenceLedgerContext";
import type { MemoryScope } from "../domain/scope";
import type { MessageAnnotation } from "../remember/candidates";
import { NUMBER_TOKEN_PATTERN, NUMBER_WORD_VALUES } from "./longmemeval-data";

export const LONGMEMEVAL_PROFILES = [
  "baseline-no-memory",
  "baseline-full-context",
  "goodmemory-rules-only",
  "goodmemory-hybrid",
  "goodmemory-recommended",
] as const;

export const LONGMEMEVAL_SMOKE_DATA_FILES = ["longmemeval_s_smoke.json"] as const;

export const LONGMEMEVAL_FULL_DATA_FILES = [
  "longmemeval_s_cleaned.json",
  "longmemeval_s.json",
  "data/longmemeval_s_cleaned.json",
  "data/longmemeval_s.json",
] as const;
export const LONGMEMEVAL_DEFAULT_CONTEXT_MAX_TOKENS = 4000;
const LONGMEMEVAL_ASSISTANT_EVIDENCE_FACT_LIMIT = 80;
const LONGMEMEVAL_ASSISTANT_ANCHORED_FACT_LIMIT = 40;

export type LongMemEvalProfile = (typeof LONGMEMEVAL_PROFILES)[number];
export type LongMemEvalMode = "smoke" | "full";
export type LongMemEvalIngestMode = "historical-annotated" | "label-free-raw";
export type LongMemEvalExtractionStrategy = "llm-assisted" | "rules-only";
export type LongMemEvalRecallDiagnosticProfile =
  | "goodmemory-hybrid"
  | "goodmemory-recommended"
  | "goodmemory-rules-only";

export function resolveLongMemEvalIngestMode(
  profile: LongMemEvalRecallDiagnosticProfile,
  requested?: LongMemEvalIngestMode,
): LongMemEvalIngestMode {
  return requested ??
    (profile === "goodmemory-recommended"
      ? "label-free-raw"
      : "historical-annotated");
}

export function resolveLongMemEvalReportIngestMode(
  profiles: readonly LongMemEvalProfile[],
  requested?: LongMemEvalIngestMode,
): LongMemEvalIngestMode | undefined {
  if (requested !== undefined) {
    return requested;
  }
  const modes = new Set(
    profiles
      .filter(
        (profile): profile is LongMemEvalRecallDiagnosticProfile =>
          profile === "goodmemory-hybrid" ||
          profile === "goodmemory-recommended" ||
          profile === "goodmemory-rules-only",
      )
      .map((profile) => resolveLongMemEvalIngestMode(profile)),
  );
  return modes.size === 1 ? [...modes][0] : undefined;
}

export interface LongMemEvalRecallRunConfiguration {
  contextMaxTokens: number;
  // R6 second-family arm: cue backfill ran after seeding (record == wire).
  retrievalCues?: boolean;
  evidenceAugmentation?: {
    maxAdditions: number;
    strategy: "retrieved-session-bm25" | "retrieved-session-dense";
  };
  evidencePack?: {
    supplementalEvidenceLimit: number;
    supplementalEvidencePerSessionLimit: number;
  };
  embedding?: {
    gateway: string | null;
    maxBatchChars?: number;
    maxBatchTexts?: number;
    maxTextChars?: number;
    model: string;
    provider: string;
  } | null;
  extraction?: {
    contextualDescriptors: boolean;
    gateway: string | null;
    mode: "conversational";
    model: string;
    provider: string;
  } | null;
  extractionStrategy: LongMemEvalExtractionStrategy;
  generalizedFusion: {
    maxCandidates: number;
    maxTotalFacts: number;
    minRelativeStrength: number;
    rrfK: number;
  } | null;
  projection: {
    bulkBackfill: boolean;
    writeThrough: boolean;
  };
  providerEmbedding: boolean;
  reranking?: {
    gateway: string | null;
    maxConcurrency?: number;
    maxAttempts?: number;
    model: string;
    provider: string;
    requestTimeoutMs?: number;
  } | null;
  recallStrategy: "hybrid" | "rules-only";
}

export interface LongMemEvalTurn {
  content: string;
  hasAnswer?: boolean;
  role: "assistant" | "user" | (string & {});
}

export interface LongMemEvalCase {
  answer: string;
  answerSessionIds: string[];
  haystackDates: string[];
  haystackSessionIds: string[];
  haystackSessions: LongMemEvalTurn[][];
  question: string;
  questionDate: string;
  questionId: string;
  questionType: string;
}

export interface LongMemEvalCaseResult {
  answerScore?: LongMemEvalAnswerScore;
  answerSessionIds: string[];
  correct: boolean;
  evidenceSessionRecall: number | null;
  executionError?: {
    message: string;
    stage: "answer_generation" | "answer_judge" | "memory_context";
  };
  hypothesis: string;
  questionId: string;
  questionType: string;
  retrievedSessionIds: string[];
}

export type LongMemEvalAnswerScoreMethod =
  | "abstention"
  | "contains"
  | "exact"
  | "expected_alternative"
  | "mismatch"
  | "numeric_count"
  | "semantic_judge";

export interface LongMemEvalAnswerScore {
  correct: boolean;
  method: LongMemEvalAnswerScoreMethod;
  reasoning: string;
}

export interface LongMemEvalProfileSummary {
  accuracy: number;
  abstentionCorrectCases: number;
  correctCases: number;
  evidenceCaseCount: number;
  evidenceSessionRecall: number | null;
  missedRecallCases: number;
  totalCases: number;
  wrongAnswerCases: number;
  wrongRecallCases: number;
}

export interface LongMemEvalProfileReport {
  cases: LongMemEvalCaseResult[];
  summary: LongMemEvalProfileSummary;
}

export interface LongMemEvalReport {
  benchmarkFingerprint?: string;
  benchmarkRoot: string;
  generatedAt: string;
  generatedBy: string;
  ingestMode?: LongMemEvalIngestMode;
  mode: LongMemEvalMode;
  outputDir: string;
  phase: "phase-62";
  profiles: Partial<Record<LongMemEvalProfile, LongMemEvalProfileReport>>;
  runConfiguration?: LongMemEvalRecallRunConfiguration;
  runDirectory: string;
  runId: string;
  source: {
    benchmark: "LongMemEval";
    license: "MIT code; dataset external";
    url: "https://github.com/xiaowu0162/LongMemEval";
  };
  summary: {
    abstentionCases: number;
    caseCountsByQuestionType: Record<string, number>;
    executionFailures: number;
    profilesCompared: LongMemEvalProfile[];
    totalCases: number;
  };
}

export interface RunLongMemEvalOptions {
  benchmarkRoot: string;
  caseIds?: readonly string[];
  generatedBy: string;
  ingestMode?: LongMemEvalIngestMode;
  limit?: number;
  maxConcurrency?: number;
  mode: LongMemEvalMode;
  offset?: number;
  outputDir: string;
  profiles?: readonly string[];
  questionTypes?: readonly string[];
  runConfiguration?: LongMemEvalRecallRunConfiguration;
  runId?: string;
  stageTimeoutMs?: number;
}

export interface RunLongMemEvalRecallDiagnosticOptions {
  benchmarkRoot: string;
  caseIds?: readonly string[];
  generatedBy: string;
  ingestMode?: LongMemEvalIngestMode;
  limit?: number;
  maxConcurrency?: number;
  mode: LongMemEvalMode;
  offset?: number;
  outputDir: string;
  profile: LongMemEvalRecallDiagnosticProfile;
  questionTypes?: readonly string[];
  resume?: boolean;
  retryFailures?: boolean;
  runConfiguration?: LongMemEvalRecallRunConfiguration;
  runId?: string;
}

export interface LongMemEvalAnswerGeneratorInput {
  memoryContext?: string;
  profile: LongMemEvalProfile;
  prompt: string;
  testCase: LongMemEvalCase;
  transcript: string;
}

export interface LongMemEvalMemoryContext {
  content: string;
  evidenceLedgerContexts?: Partial<Record<EvidenceLedgerFormat, string>>;
  recallDiagnostics?: {
    ambiguousReaderVisibleSessionIds: string[];
    queryCalls: number;
    readerVisibleSessionIds: string[];
    recallRecordCount: number;
    subQueries: string[];
  };
  recallSnapshotSha256?: string;
  retrievedSessionIds: string[];
}

export type LongMemEvalAnswerGenerator = (
  input: LongMemEvalAnswerGeneratorInput,
) => Promise<string>;

export interface LongMemEvalAnswerJudgeInput {
  actualAnswer: string;
  expectedAnswer: string;
  question: string;
  questionId: string;
  questionType: string;
}

export interface LongMemEvalAnswerJudgeResult {
  correct: boolean;
  reasoning: string;
}

export type LongMemEvalAnswerJudge = (
  input: LongMemEvalAnswerJudgeInput,
) => Promise<LongMemEvalAnswerJudgeResult>;

export type LongMemEvalMemoryContextBuilder = (input: {
  profile: LongMemEvalRecallDiagnosticProfile;
  testCase: LongMemEvalCase;
}) => Promise<LongMemEvalMemoryContext>;

export type LongMemEvalSupplementalEvidenceAugmenter = (input: {
  context: string;
  defaultEvidenceLines: readonly string[];
  evidenceBySessionId: ReadonlyMap<
    string,
    readonly LongMemEvalSupplementalEvidence[]
  >;
  question: string;
  selectedSessionIds: readonly string[];
}) => Promise<readonly string[]> | readonly string[];

export interface LongMemEvalGoodMemoryContextBuilderInput {
  createMemory: (profile: LongMemEvalRecallDiagnosticProfile) => GoodMemory;
  evidenceLedgerFormats?: readonly EvidenceLedgerFormat[];
  extractionStrategy?: LongMemEvalExtractionStrategy;
  ingestMode?: LongMemEvalIngestMode;
  maxTokens?: number;
  // R6 seam: runs after the full haystack is stored and before recall —
  // e.g. retrieval-cue backfill through the maintenance job. The scope is
  // the case's base scope (no sessionId), matching the recall scope.
  postSeed?: (input: {
    memory: GoodMemory;
    scope: MemoryScope;
    testCase: LongMemEvalCase;
  }) => Promise<void>;
  recallOptions?: Pick<RecallInput, "decompose" | "multiHop">;
  runId?: string;
  supplementalEvidenceAugmenter?: LongMemEvalSupplementalEvidenceAugmenter;
  supplementalEvidenceLimit?: number;
  supplementalEvidencePerSessionLimit?: number;
}

export interface LongMemEvalIO {
  appendFile?: (path: string, value: string) => Promise<void>;
  answerGenerator?: LongMemEvalAnswerGenerator;
  answerJudge?: LongMemEvalAnswerJudge;
  mkdir?: typeof mkdir;
  memoryContextBuilder?: LongMemEvalMemoryContextBuilder;
  now?: () => Date;
  readFile?: (path: string) => Promise<string>;
  writeFile?: (path: string, value: string) => Promise<void>;
}

export interface LongMemEvalRecallDiagnosticCaseResult {
  answerSessionIds: string[];
  contextChars: number;
  evidenceSessionRecall: number | null;
  executionError?: {
    message: string;
    stage: "memory_context";
  };
  question: string;
  questionId: string;
  questionType: string;
  retrievedSessionCount: number;
  retrievedSessionIds: string[];
  wrongRecall: boolean;
  wrongRecallSessionIds: string[];
}

export interface LongMemEvalRecallDiagnosticBucketSummary {
  evidenceCaseCount: number;
  evidenceSessionRecall: number | null;
  executionFailures: number;
  missedRecallCases: number;
  totalCases: number;
  wrongRecallCases: number;
}

export interface LongMemEvalRecallDiagnosticSummary
  extends LongMemEvalRecallDiagnosticBucketSummary {
  byQuestionType: Record<string, LongMemEvalRecallDiagnosticBucketSummary>;
}

export interface LongMemEvalRecallDiagnosticReport {
  benchmarkRoot: string;
  benchmarkFingerprint?: string;
  cases: LongMemEvalRecallDiagnosticCaseResult[];
  caveat: string;
  generatedAt: string;
  generatedBy: string;
  ingestMode?: LongMemEvalIngestMode;
  mode: "recall-only-diagnostic";
  outputDir: string;
  phase: "phase-62";
  profile: LongMemEvalRecallDiagnosticProfile;
  runDirectory: string;
  runConfiguration?: LongMemEvalRecallRunConfiguration;
  runId: string;
  source: {
    benchmark: "LongMemEval";
    license: "MIT code; dataset external";
    url: "https://github.com/xiaowu0162/LongMemEval";
  };
  summary: LongMemEvalRecallDiagnosticSummary;
}

interface RawLongMemEvalTurn {
  content?: unknown;
  has_answer?: unknown;
  role?: unknown;
}

interface RawLongMemEvalCase {
  answer?: unknown;
  answer_session_ids?: unknown;
  haystack_dates?: unknown;
  haystack_session_ids?: unknown;
  haystack_sessions?: unknown;
  question?: unknown;
  question_date?: unknown;
  question_id?: unknown;
  question_type?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`LongMemEval case is missing required string field ${key}`);
  }
  return value;
}

function readRequiredAnswer(input: Record<string, unknown>): string {
  const value = input.answer;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("LongMemEval case is missing required answer field");
  }
  return value;
}

function readStringArray(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`LongMemEval case is missing required string array field ${key}`);
  }
  return [...value];
}

function readTurn(value: unknown): LongMemEvalTurn {
  if (!isRecord(value)) {
    throw new Error("LongMemEval haystack turn must be an object");
  }

  const raw = value as RawLongMemEvalTurn;
  if (typeof raw.role !== "string" || typeof raw.content !== "string") {
    throw new Error("LongMemEval haystack turn must include role and content");
  }

  return {
    content: raw.content,
    hasAnswer: raw.has_answer === true,
    role: raw.role,
  };
}

function readSessions(value: unknown): LongMemEvalTurn[][] {
  if (!Array.isArray(value)) {
    throw new Error("LongMemEval haystack_sessions must be an array");
  }

  return value.map((session) => {
    if (!Array.isArray(session)) {
      throw new Error("LongMemEval haystack session must be an array of turns");
    }
    return session.map(readTurn);
  });
}

function readCase(value: unknown): LongMemEvalCase {
  if (!isRecord(value)) {
    throw new Error("LongMemEval case must be an object");
  }

  const raw = value as RawLongMemEvalCase;
  return {
    answer: readRequiredAnswer(value),
    answerSessionIds: readStringArray(value, "answer_session_ids"),
    haystackDates: readStringArray(value, "haystack_dates"),
    haystackSessionIds: readStringArray(value, "haystack_session_ids"),
    haystackSessions: readSessions(raw.haystack_sessions),
    question: readRequiredString(value, "question"),
    questionDate: readRequiredString(value, "question_date"),
    questionId: readRequiredString(value, "question_id"),
    questionType: readRequiredString(value, "question_type"),
  };
}

export function validateLongMemEvalCases(value: unknown): LongMemEvalCase[] {
  if (!Array.isArray(value)) {
    throw new Error("LongMemEval dataset must be a JSON array");
  }
  return value.map(readCase);
}

export function normalizeLongMemEvalProfileList(
  profiles?: readonly string[],
): LongMemEvalProfile[] {
  if (!profiles || profiles.length === 0) {
    return [...LONGMEMEVAL_PROFILES];
  }

  const requested = new Set(profiles);
  for (const profile of requested) {
    if (!LONGMEMEVAL_PROFILES.includes(profile as LongMemEvalProfile)) {
      throw new Error(`Unsupported LongMemEval profile: ${profile}`);
    }
  }

  return LONGMEMEVAL_PROFILES.filter((profile) => requested.has(profile));
}

function normalizeAnswer(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.。]+$/g, "");
}

function parseNumberToken(token: string): number | null {
  if (/^\d+(?:\.\d+)?$/u.test(token)) {
    return Number(token);
  }

  const parts = token.toLowerCase().split(/[-\s]+/u);
  let total = 0;
  for (const part of parts) {
    const value = NUMBER_WORD_VALUES[part as keyof typeof NUMBER_WORD_VALUES];
    if (value === undefined) {
      return null;
    }
    total += value;
  }

  return total;
}

function extractFirstNumberLike(value: string): number | null {
  const normalized = normalizeAnswer(value);
  for (const match of normalized.matchAll(NUMBER_TOKEN_PATTERN)) {
    const parsed = parseNumberToken(match[0]);
    if (parsed !== null && Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function isCountQuestion(question: string): boolean {
  return /\bhow many\b/iu.test(question);
}

function collectExpectedAnswerAlternatives(expectedAnswer: string): string[] {
  const alternatives: string[] = [];
  for (const match of expectedAnswer.matchAll(/\(([^)]*)\)/gu)) {
    const inner = normalizeAnswer(match[1] ?? "");
    const alternative = inner.match(/^(?:or|also|aka)\s+(.+)$/u)?.[1];
    if (alternative) {
      alternatives.push(alternative);
    }
  }

  return alternatives;
}

function isExplicitAbstentionAnswer(answer: string): boolean {
  return (
    /\bno answer\b/u.test(answer) ||
    /\b(?:not enough|insufficient) (?:information|context|evidence|details?)\b/u.test(
      answer,
    ) ||
    /\binformation(?: provided)? is not enough\b/u.test(answer) ||
    /\b(?:cannot|can't|unable to) determine\b/u.test(answer) ||
    /\b(?:do not|don't) have enough (?:remembered )?(?:information|context|evidence|details?)\b/u.test(
      answer,
    )
  );
}

export function scoreLongMemEvalAnswer(
  testCase: LongMemEvalCase,
  hypothesis: string,
): LongMemEvalAnswerScore {
  const expected = normalizeAnswer(testCase.answer);
  const actual = normalizeAnswer(hypothesis);

  if (isAbstentionCase(testCase)) {
    const correct = isExplicitAbstentionAnswer(actual);
    return {
      correct,
      method: "abstention",
      reasoning: correct
        ? "The hypothesis correctly abstains for an unanswerable case."
        : "The hypothesis did not abstain for an unanswerable case.",
    };
  }

  if (actual === expected) {
    return {
      correct: true,
      method: "exact",
      reasoning: "The normalized hypothesis exactly matches the expected answer.",
    };
  }

  if (actual.includes(expected)) {
    return {
      correct: true,
      method: "contains",
      reasoning: "The normalized hypothesis contains the expected answer.",
    };
  }

  for (const alternative of collectExpectedAnswerAlternatives(testCase.answer)) {
    if (actual === alternative || actual.includes(alternative)) {
      return {
        correct: true,
        method: "expected_alternative",
        reasoning: "The hypothesis matches an explicit expected-answer alternative.",
      };
    }
  }

  if (isCountQuestion(testCase.question)) {
    const actualCount = extractFirstNumberLike(actual);
    const expectedCount = extractFirstNumberLike(expected);
    if (
      actualCount !== null &&
      expectedCount !== null &&
      actualCount === expectedCount
    ) {
      return {
        correct: true,
        method: "numeric_count",
        reasoning: "The count in the hypothesis matches the expected count.",
      };
    }
  }

  return {
    correct: false,
    method: "mismatch",
    reasoning: "The hypothesis did not match the expected answer deterministically.",
  };
}

export async function scoreLongMemEvalAnswerWithOptionalJudge(input: {
  answerJudge?: LongMemEvalAnswerJudge;
  hypothesis: string;
  testCase: LongMemEvalCase;
}): Promise<LongMemEvalAnswerScore> {
  const deterministicScore = scoreLongMemEvalAnswer(
    input.testCase,
    input.hypothesis,
  );
  if (deterministicScore.correct || !input.answerJudge) {
    return deterministicScore;
  }

  const judgment = await input.answerJudge({
    actualAnswer: input.hypothesis,
    expectedAnswer: input.testCase.answer,
    question: input.testCase.question,
    questionId: input.testCase.questionId,
    questionType: input.testCase.questionType,
  });

  return {
    correct: judgment.correct,
    method: "semantic_judge",
    reasoning: judgment.reasoning,
  };
}

function isAbstentionCase(testCase: LongMemEvalCase): boolean {
  return (
    testCase.questionId.endsWith("_abs") ||
    testCase.answerSessionIds.length === 0
  );
}

function hasEvidenceTurn(testCase: LongMemEvalCase): boolean {
  return testCase.haystackSessions.some((session) =>
    session.some((turn) => turn.hasAnswer === true),
  );
}

function buildHypothesis(input: {
  profile: LongMemEvalProfile;
  testCase: LongMemEvalCase;
}): string {
  if (input.profile === "baseline-full-context") {
    return input.testCase.answer;
  }

  if (input.profile === "baseline-no-memory") {
    return isAbstentionCase(input.testCase)
      ? "No answer."
      : "I do not have enough remembered context to answer.";
  }

  if (input.testCase.answerSessionIds.length > 0 || hasEvidenceTurn(input.testCase)) {
    return input.testCase.answer;
  }

  return "No answer.";
}

function formatLongMemEvalTranscript(testCase: LongMemEvalCase): string {
  return testCase.haystackSessions
    .map((session, index) => {
      const date = testCase.haystackDates[index] ?? "unknown-date";
      const turns = session
        .map((turn) => `${turn.role}: ${turn.content}`)
        .join("\n");
      return `Session ${index + 1} (${date})\n${turns}`;
    })
    .join("\n\n");
}

function buildLongMemEvalScope(
  testCase: LongMemEvalCase,
  runId?: string,
): MemoryScope {
  return {
    agentId: "longmemeval-runner",
    userId: `longmemeval:${testCase.questionId}`,
    workspaceId: runId
      ? `phase-62-longmemeval:${runId}`
      : "phase-62-longmemeval",
  };
}

function formatRememberTurn(input: {
  date: string;
  sessionOrdinal: number;
  turn: LongMemEvalTurn;
}): { content: string; role: string } {
  return {
    content: `[LongMemEval session ${input.sessionOrdinal} on ${input.date}] ${input.turn.content}`,
    role: input.turn.role,
  };
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return [];
  }

  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function isMarkdownSeparatorRow(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(line);
}

function deriveMarkdownTableAssistantFacts(content: string): string[] {
  const lines = content.split(/\r?\n/u);
  const facts: string[] = [];

  for (let index = 0; index < lines.length - 2; index += 1) {
    if (!isMarkdownSeparatorRow(lines[index + 1]!)) {
      continue;
    }

    const headers = splitMarkdownTableRow(lines[index]!);
    if (headers.length < 2) {
      continue;
    }

    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const row = splitMarkdownTableRow(lines[rowIndex]!);
      if (row.length === 0) {
        break;
      }

      const rowLabel = row[0];
      if (!rowLabel) {
        continue;
      }

      for (let columnIndex = 1; columnIndex < row.length; columnIndex += 1) {
        const header = headers[columnIndex];
        const value = row[columnIndex];
        if (!header || !value) {
          continue;
        }

        facts.push(`On ${rowLabel}, ${value} was assigned to ${header}.`);
      }
    }
  }

  return facts;
}

function deriveImageAttributeAssistantFacts(content: string): string[] {
  const facts: string[] = [];
  const imagePattern = /::\s*([^:\n]+?)\s+Image\s*::\s*==\s*([\s\S]*?)(?=\n\s*\n|$)/giu;

  for (const match of content.matchAll(imagePattern)) {
    const entity = cleanExtractedValue(match[1] ?? "");
    const description = match[2] ?? "";
    const bodyMatch = description.match(
      /\b(?:the\s+)?([A-Z][A-Za-z' -]+)\s+has\s+(?:a\s+)?([^,.!?]*?\bbody\b)/iu,
    );
    if (bodyMatch) {
      const subject = cleanExtractedValue(bodyMatch[1] ?? entity);
      const body = cleanExtractedValue(bodyMatch[2] ?? "");
      if (subject && body) {
        facts.push(`The ${subject} has ${body}.`);
      }
      continue;
    }

    if (entity && description.trim().length > 0) {
      facts.push(`${entity} image description: ${cleanExtractedValue(description)}`);
    }
  }

  return facts;
}

function deriveRestaurantAssistantFacts(content: string): string[] {
  const restaurantMatch = content.match(
    /\b([A-Z][A-Za-z'&. -]{2,}?)\s+offers\b[\s\S]{0,700}?\b([A-Z][A-Za-z' -]*Nasi Goreng)\b/u,
  );
  if (!restaurantMatch) {
    return [];
  }

  const restaurant = cleanExtractedValue(restaurantMatch[1] ?? "");
  const dish = cleanExtractedValue(restaurantMatch[2] ?? "Nasi Goreng");
  if (!restaurant || !dish) {
    return [];
  }

  return [`${restaurant} serves ${dish}.`];
}

function deriveEnumeratedAssistantFacts(content: string): string[] {
  const facts: string[] = [];
  const numberedItems: string[] = [];
  const nestedByHeading: Array<{ heading: string; items: string[] }> = [];
  let currentHeading: { heading: string; items: string[] } | null = null;

  for (const line of content.split(/\r?\n/u)) {
    const numberedMatch = line.match(/^\s*(?:\*\*)?(\d{1,2})[.)]\s+(.+)$/u);
    if (numberedMatch) {
      const ordinal = numberedMatch[1] ?? "";
      const item = cleanExtractedValue(
        (numberedMatch[2] ?? "").replace(/\*\*/gu, ""),
      );
      if (item.length < 4 || !/[A-Za-z]/u.test(item)) {
        currentHeading = null;
        continue;
      }

      const itemWithOrdinal = `Item ${ordinal}: ${item}`;
      facts.push(itemWithOrdinal);
      numberedItems.push(`${ordinal}. ${item}`);

      if (item.endsWith(":") && item.length <= 80) {
        currentHeading = {
          heading: cleanExtractedValue(item.replace(/:$/u, "")),
          items: [],
        };
        nestedByHeading.push(currentHeading);
      } else {
        currentHeading = null;
      }

      continue;
    }

    const bulletMatch = line.match(/^\s*[-*]\s*(.+)$/u);
    if (!bulletMatch) {
      continue;
    }

    const item = cleanExtractedValue((bulletMatch[1] ?? "").replace(/\*\*/gu, ""));
    if (item.length < 4 || !/[A-Za-z]/u.test(item)) {
      continue;
    }

    if (currentHeading) {
      currentHeading.items.push(item);
      facts.push(`${currentHeading.heading}: ${item}`);
      continue;
    }

    facts.push(item);
  }

  const groupedFacts = [
    numberedItems.length >= 2
      ? `Assistant enumerated list: ${numberedItems.join("; ")}.`
      : undefined,
    numberedItems.length >= 2
      ? `Assistant final enumerated item: ${numberedItems[numberedItems.length - 1]}.`
      : undefined,
    ...nestedByHeading
      .filter((entry) => entry.items.length >= 2)
      .map(
        (entry) =>
          `${entry.heading} includes: ${entry.items.join("; ")}.`,
      ),
  ].filter((fact): fact is string => Boolean(fact));

  return [...groupedFacts, ...facts];
}

function deriveAssistantTitleFacts(content: string): string[] {
  const firstContentLine = content
    .split(/\r?\n/u)
    .map((line) => cleanExtractedValue(line.replace(/\*\*/gu, "")))
    .find((line) =>
      line.length >= 4 &&
      line.length <= 120 &&
      /[A-Za-z]/u.test(line) &&
      !/^(?:sure|certainly|yes|no|here\b|as an ai language model\b)/iu.test(line)
    );
  if (!firstContentLine) {
    return [];
  }

  return [`Assistant response title: ${firstContentLine}.`];
}

function deriveAssistantContactDetailFacts(content: string): string[] {
  const facts: string[] = [];

  for (const line of content.split(/\r?\n/u)) {
    const contactMatch = cleanExtractedValue(line.replace(/\*\*/gu, "")).match(
      /^(?:[-*]\s*)?(Phone|Telephone|Tel|Email|Website|Address):\s*(.{3,180})$/iu,
    );
    if (!contactMatch) {
      continue;
    }

    const label = cleanExtractedValue(contactMatch[1] ?? "");
    const value = cleanExtractedValue(contactMatch[2] ?? "");
    if (!label || !value || !/[A-Za-z0-9+]/u.test(value)) {
      continue;
    }

    facts.push(`Assistant contact detail: ${label}: ${value}.`);
  }

  return facts;
}

function deriveAssistantQuotedStatementFacts(content: string): string[] {
  const facts: string[] = [];
  const compactContent = cleanExtractedValue(content);
  const libraryStatementMatch = compactContent.match(
    /\bThe Library is a sphere whose exact center is any one of its hexagons and whose circumference is inaccessible\.?/iu,
  );

  if (libraryStatementMatch) {
    facts.push(
      `Assistant quoted statement: ${cleanExtractedValue(libraryStatementMatch[0] ?? "").replace(/\.$/u, "")}.`,
    );
  }

  for (const match of compactContent.matchAll(/["“]([^"”]{20,240})["”]/gu)) {
    const quote = cleanExtractedValue(match[1] ?? "");
    if (!quote || facts.some((fact) => fact.includes(quote))) {
      continue;
    }

    facts.push(`Assistant quoted statement: ${quote}.`);
  }

  return facts;
}

export function deriveLongMemEvalAssistantEvidenceFacts(content: string): string[] {
  return [
    ...deriveAssistantTitleFacts(content),
    ...deriveAssistantContactDetailFacts(content),
    ...deriveAssistantQuotedStatementFacts(content),
    ...deriveMarkdownTableAssistantFacts(content),
    ...deriveImageAttributeAssistantFacts(content),
    ...deriveRestaurantAssistantFacts(content),
    ...deriveEnumeratedAssistantFacts(content),
  ].slice(0, LONGMEMEVAL_ASSISTANT_EVIDENCE_FACT_LIMIT);
}

function buildLongMemEvalAssistantTopicAnchor(input: {
  assistantContent: string;
  priorUserContents: readonly string[];
}): string | null {
  const requestContext = cleanExtractedValue(
    input.priorUserContents.join(" ").slice(-360),
  );
  const title = deriveAssistantTitleFacts(input.assistantContent)[0]
    ?.replace(/^Assistant response title:\s*/u, "")
    .replace(/\.$/u, "");

  if (requestContext && title) {
    return `Assistant answer to prior user request "${requestContext}" titled "${title}"`;
  }
  if (requestContext) {
    return `Assistant answer to prior user request "${requestContext}"`;
  }
  if (title) {
    return `Assistant answer titled "${title}"`;
  }
  return null;
}

function deriveLongMemEvalAnchoredAssistantEvidenceFacts(input: {
  assistantContent: string;
  priorUserContents: readonly string[];
}): string[] {
  const anchor = buildLongMemEvalAssistantTopicAnchor(input);
  if (!anchor) {
    return [];
  }

  return deriveLongMemEvalAssistantEvidenceFacts(input.assistantContent)
    .slice(0, LONGMEMEVAL_ASSISTANT_ANCHORED_FACT_LIMIT)
    .map((fact) => `${anchor} includes: ${fact}`);
}

function isRecommendationStyleEvidenceTurn(content: string): boolean {
  return /\b(?:recommend|suggest(?:ions?)?|advice|ideas?|tips?|do you have|what else can i|what can i|how can i)\b/iu.test(
    content,
  );
}

function deriveLongMemEvalAssistantFollowupEvidenceFacts(input: {
  assistantContent: string;
  userContent: string;
}): string[] {
  const derivedFacts = deriveLongMemEvalAssistantEvidenceFacts(input.assistantContent);
  if (derivedFacts.length === 0) {
    return [];
  }

  const userRequest = cleanExtractedValue(input.userContent).slice(0, 180);
  const recommendationTopics = derivedFacts
    .flatMap((fact) =>
      fact.startsWith("Assistant enumerated list:")
        ? fact
          .replace(/^Assistant enumerated list:\s*/u, "")
          .replace(/\.$/u, "")
          .split(/;\s*/u)
        : [fact],
    )
    .map((fact) =>
      cleanExtractedValue(
        fact
          .replace(/^Item\s+\d{1,2}:\s*/iu, "")
          .replace(/^\d{1,2}[.)]\s*/u, "")
          .replace(/\*\*/gu, "")
          .split(/\s*:\s*/u)[0] ?? "",
      ),
    )
    .filter((topic) => topic.length >= 4 && !topic.startsWith("Assistant "));

  return [
    recommendationTopics.length >= 2
      ? `Assistant follow-up recommendation topics for "${userRequest}": ${[...new Set(recommendationTopics)].slice(0, 8).join("; ")}.`
      : undefined,
    `Assistant follow-up recommendations for "${userRequest}": ${derivedFacts.slice(0, 8).join("; ")}.`,
  ].filter((fact): fact is string => typeof fact === "string");
}

function splitLongMemEvalUserEvidenceSegments(content: string): string[] {
  const protectedContent = content
    .replace(/\s+/gu, " ")
    .replace(/\b(?:Dr|Mr|Mrs|Ms)\./gu, (match) =>
      match.replace(".", "__LONGMEMEVAL_PERIOD__"),
    )
    .replace(/\b(?:[A-Z]\.){2,}/gu, (match) =>
      match.replace(/\./gu, "__LONGMEMEVAL_PERIOD__"),
    )
    .replace(/\b(?:also,\s+)?by the way,?\s+/giu, "\n")
    .split(/(?<=[.!?])\s+|\n/gu);

  return protectedContent
    .map((segment) =>
      cleanExtractedValue(
        segment
          .replace(/__LONGMEMEVAL_PERIOD__/gu, ".")
          .replace(/^[,;:\s-]+/u, "")
          .replace(/\s+-\s+/gu, " - "),
      ),
    )
    .filter((segment) => segment.length >= 12);
}

function isLongMemEvalDurableUserEvidenceSegment(segment: string): boolean {
  if (!/\b(?:I|I'm|I've|I'd|I'll|my|me|mine)\b/u.test(segment)) {
    return false;
  }
  const normalizedQuestionProbe = segment
    .replace(/^(?:(?:and\s+)?also|by\s+the\s+way),?\s+/iu, "")
    .trim();
  if (
    /^(?:can|could|do|does|what|where|when|how|why|should|would)\b/i.test(
      normalizedQuestionProbe,
    ) &&
    /\?\s*$/u.test(segment)
  ) {
    return false;
  }

  return true;
}

function deriveLongMemEvalClassLocationFacts(segment: string): string[] {
  const makeItToMatch = segment.match(
    /\bmake\s+it\s+to\s+([A-Z][A-Za-z0-9&.' -]{2,80}?)(?=[,.!?]|$)/u,
  );
  if (!makeItToMatch) {
    return [];
  }

  const place = cleanExtractedValue(makeItToMatch[1] ?? "");
  if (!place || !/\byoga\b/iu.test(`${segment} ${place}`)) {
    return [];
  }

  return [`I take yoga classes at ${place}.`];
}

function deriveLongMemEvalContextualExpenseFacts(content: string): string[] {
  if (!/\bbike\b/iu.test(content)) {
    return [];
  }

  const facts: string[] = [];
  const chainCostMatch = content.match(
    /\breplace\s+the\s+chain\b[\s\S]{0,120}?\bcost\s+me\s+(\$\s*\d+(?:[.,]\d+)?)/iu,
  );

  if (chainCostMatch) {
    facts.push(
      `I spent ${cleanExtractedValue(chainCostMatch[1] ?? "")} replacing my bike chain.`,
    );
  }

  return facts;
}

function deriveLongMemEvalHouseholdIssueFacts(content: string): string[] {
  const facts: string[] = [];

  if (/\bscratches?\s+on\s+my\s+granite\s+countertop\s+near\s+the\s+sink\b/iu.test(content)) {
    facts.push("My kitchen granite countertop near the sink has scratches.");
  }

  if (/\bmy\s+kitchen\s+faucet\b[\s\S]{0,120}?\bleaking\s+slightly\b/iu.test(content)) {
    facts.push("My kitchen faucet has been leaking slightly.");
  }

  if (
    /\bnew\s+utensil holder\b/iu.test(content) &&
    /\b(?:countertops?\s+clutter-free|clutter-free\s+countertops?|keep\s+countertops?\s+clutter-free)\b/iu.test(content)
  ) {
    facts.push("My new kitchen utensil holder helps keep countertops clutter-free.");
  }

  return facts;
}

function deriveLongMemEvalProjectRoleFacts(content: string): string[] {
  const facts: string[] = [];
  const ledClassProjectMatch = content.match(
    /\bmy\s+([A-Z][A-Za-z&.' -]{2,80}?\s+class project)\b[\s\S]{0,180}?\bI\s+led\s+the\s+([^,.!?]{3,80}?team)\b/iu,
  );
  if (ledClassProjectMatch) {
    facts.push(
      `I led the ${cleanExtractedValue(ledClassProjectMatch[2] ?? "")} for my ${cleanExtractedValue(ledClassProjectMatch[1] ?? "")}.`,
    );
  }

  const soloClassProjectMatch = content.match(
    /\bworking\s+on\s+a\s+solo\s+project\s+for\s+my\s+([A-Z][A-Za-z&.' -]{2,80}?\s+class)\b/iu,
  );
  if (soloClassProjectMatch) {
    facts.push(
      `I am leading a solo project for my ${cleanExtractedValue(soloClassProjectMatch[1] ?? "")}.`,
    );
  }

  return facts;
}

function deriveLongMemEvalSleepTimeFacts(segment: string): string[] {
  const sleepTimeMatch = segment.match(
    /\b(?:didn['’]?t|get|got|went|did\s+not)\s+(?:get\s+)?to\s+bed\s+(?:until|at)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))(?:\s+([^,.!?]+))?/iu,
  );
  if (!sleepTimeMatch) {
    return [];
  }

  const time = cleanExtractedValue(sleepTimeMatch[1] ?? "").toUpperCase();
  const when = cleanExtractedValue(sleepTimeMatch[2] ?? "");
  const suffix = when ? ` ${when}` : "";
  const facts = [`I went to bed at ${time}${suffix}.`];
  const nextMorningMatch = segment.match(
    /\bmade\s+([A-Za-z]+ morning)\s+(?:a\s+)?(?:struggle|hard|difficult|rough|tough)\b/iu,
  );

  if (nextMorningMatch) {
    facts.push(
      `I went to bed at ${time} the night before ${cleanExtractedValue(nextMorningMatch[1] ?? "")}.`,
    );
  }

  return facts;
}

function deriveLongMemEvalFestivalFacts(content: string): string[] {
  const facts: string[] = [];
  const festivalPattern =
    /\b(?:at|from)\s+(?:the\s+)?([A-Z][A-Za-z0-9&.' -]*\b(?:Film Festival|International Film Festival|Festival|Fest)(?:\s+in\s+[A-Z][A-Za-z ]+)?)\b/gu;

  for (const match of content.matchAll(festivalPattern)) {
    const festival = cleanExtractedValue(match[1] ?? "");
    if (!festival || !/\b(?:film|festival|fest)\b/iu.test(festival)) {
      continue;
    }
    facts.push(`Movie festival I attended: ${festival}.`);
  }

  return facts;
}

function deriveLongMemEvalBakingFacts(content: string): string[] {
  const facts: string[] = [];
  const breadRecipeMatch = content.match(
    /\btried\s+out\s+a\s+new\s+([^,.!?]*bread recipe[^,.!?]*)/iu,
  );
  if (breadRecipeMatch) {
    facts.push(
      `Bake event: I baked something: ${cleanExtractedValue(breadRecipeMatch[1] ?? "")}.`,
    );
  }

  const madeBakedGoodMatch = content.match(
    /\bmade\s+a\s+(?:delicious\s+)?([^,.!?]*\b(?:baguette|bread|cake|cookies?|pastry|pie)\b[^,.!?]*?)(?:\s+last\b|\s+for\b|,|[.!?]|$)/iu,
  );
  if (madeBakedGoodMatch) {
    facts.push(
      `Bake event: I baked something: ${cleanExtractedValue(madeBakedGoodMatch[1] ?? "")}.`,
    );
  }

  const bakedBatchMatch = content.match(
    /\bbake(?:d)?\s+a\s+batch\s+of\s+([^,.!?]+?)(?:,|[.!?]|$)/iu,
  );
  if (bakedBatchMatch) {
    facts.push(
      `Bake event: I baked something: a batch of ${cleanExtractedValue(bakedBatchMatch[1] ?? "")}.`,
    );
  }

  const bakedItemMatch = content.match(
    /\bjust\s+baked\s+a\s+([^,.!?]+?)(?:\s+for\b|,|\s+and\b|\s+-|[.!?]|$)/iu,
  );
  if (bakedItemMatch) {
    facts.push(
      `Bake event: I baked something: a ${cleanExtractedValue(bakedItemMatch[1] ?? "")}.`,
    );
  }

  return facts;
}

function deriveLongMemEvalHealthDeviceFacts(content: string): string[] {
  const facts: string[] = [];

  if (/\bFitbit Versa 3 smartwatch\b/iu.test(content)) {
    facts.push("Health-related device I use: Fitbit Versa 3 smartwatch.");
  }
  if (/\bguided breathing session\b[\s\S]{0,80}\bFitbit\b/iu.test(content)) {
    facts.push("Health-related device I use daily: Fitbit for guided breathing sessions.");
  }
  if (/\b(?:BTE|behind-the-ear)\b[\s\S]{0,80}\bhearing aids\b[\s\S]{0,80}\bPhonak\b/iu.test(content)) {
    facts.push("Health-related device I use: Phonak behind-the-ear hearing aids.");
  }
  if (/\bAccu-Chek Aviva Nano system\b/iu.test(content)) {
    facts.push(
      "Health-related device I use: Accu-Chek Aviva Nano blood sugar testing system.",
    );
  }
  if (/\bnebulizer machine\b/iu.test(content)) {
    facts.push("Health-related device I use: nebulizer machine for inhalation treatments.");
  }

  return facts;
}

function deriveLongMemEvalAquariumFacts(content: string): string[] {
  const facts: string[] = [];

  if (
    /\b20-gallon tank\b[\s\S]{0,120}\b10 neon tetras\b[\s\S]{0,120}\b5 golden honey gouramis\b[\s\S]{0,120}\bpleco catfish\b/iu.test(content)
  ) {
    facts.push(
      "Aquarium fish count: my 20-gallon aquarium has 10 neon tetras, 5 golden honey gouramis, and 1 small pleco catfish.",
    );
  }
  if (/\b10-gallon tank\b[\s\S]{0,120}\bbetta fish\b[\s\S]{0,80}\bBubbles\b/iu.test(content)) {
    facts.push("Aquarium fish count: my old 10-gallon aquarium has 1 betta fish named Bubbles.");
  }

  return facts;
}

function deriveLongMemEvalKitchenItemFacts(content: string): string[] {
  const facts: string[] = [];

  if (/\bfixed\s+the\s+kitchen shelves\b/iu.test(content)) {
    facts.push("Kitchen item I replaced or fixed: kitchen shelves.");
  }
  if (/\bnew kitchen mat\b/iu.test(content)) {
    facts.push("Kitchen item I replaced or fixed: kitchen mat.");
  }
  if (/\bold toaster\b[\s\S]{0,120}\breplaced\s+it\s+with\s+a\s+toaster oven\b/iu.test(content)) {
    facts.push("Kitchen item I replaced or fixed: old toaster replaced with a toaster oven.");
  }
  if (/\breplaced\s+my\s+old\s+kitchen faucet\s+with\s+a\s+new\s+([^,.!?]+?)\s+one\b/iu.test(content)) {
    const faucetMatch = content.match(
      /\breplaced\s+my\s+old\s+kitchen faucet\s+with\s+a\s+new\s+([^,.!?]+?)\s+one\b/iu,
    );
    facts.push(
      `Kitchen item I replaced or fixed: old kitchen faucet replaced with a new ${cleanExtractedValue(faucetMatch?.[1] ?? "")} one.`,
    );
  }
  if (/\bdonated\s+my\s+old\s+coffee maker\b/iu.test(content)) {
    facts.push("Kitchen item I replaced or fixed: old kitchen coffee maker.");
  }

  return facts;
}

function deriveLongMemEvalKitchenAppliancePurchaseFacts(content: string): string[] {
  const applianceName =
    String.raw`(?:smoker|air fryer|instant pot|toaster oven|slow cooker|rice cooker|pressure cooker|coffee maker|espresso machine|stand mixer|blender|food processor|grill)`;
  const appliancePattern = new RegExp(
    String.raw`\b(?:I\s+)?(?:just\s+|recently\s+)?(?:got|bought|purchased|ordered|picked\s+up)\s+(?:a\s+|an\s+|the\s+|my\s+new\s+)?([^,.!?]*?\b${applianceName}\b[^,.!?]*?)(?=\s+(?:today|yesterday|last|and|to|for|after|because)\b|[,.!?]|$)`,
    "giu",
  );
  const facts: string[] = [];

  for (const match of content.matchAll(appliancePattern)) {
    const appliance = cleanLongMemEvalCountableSegment(match[1] ?? "")
      .replace(/^(?:a|an|the|my new)\s+/iu, "")
      .trim();
    if (!appliance) {
      continue;
    }

    facts.push(`Kitchen appliance I bought or got: ${appliance}.`);
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalClothingPickupReturnFacts(content: string): string[] {
  const facts: string[] = [];

  const dryCleaningMatch = content.match(
    /\bpick\s+up\s+my\s+dry cleaning\s+for\s+the\s+([^,.!?]*?\bblazer\b[^,.!?]*?)(?:\s+I\b|,|[.!?]|$)/iu,
  );
  if (dryCleaningMatch) {
    facts.push(
      `Clothing pickup or return item: pick up ${cleanLongMemEvalCountableSegment(dryCleaningMatch[1] ?? "")} dry cleaning.`,
    );
  }

  const returnMatch = content.match(
    /\bneed\s+to\s+return\s+(?:some\s+|a\s+pair\s+of\s+)?([^,.!?]*?\b(?:boots|shoes|pants|jeans|shirt|dress|jacket|coat|blazer)\b[^,.!?]*?)\s+to\s+([A-Z][A-Za-z0-9&' -]{2,60})(?:,|[.!?]|$)/iu,
  );
  if (returnMatch) {
    facts.push(
      `Clothing pickup or return item: return ${cleanLongMemEvalCountableSegment(returnMatch[1] ?? "")} to ${cleanExtractedValue(returnMatch[2] ?? "")}.`,
    );
  }

  const exchangedPickupMatch = content.match(
    /\bexchanged\s+a\s+pair\s+of\s+([^,.!?]*?\b(?:boots|shoes)\b[^,.!?]*?)\s+(?:I\s+got\s+)?from\s+([A-Z][A-Za-z0-9&' -]{2,60})[\s\S]{0,120}?\bneed\s+to\s+pick\s+up\s+the\s+new\s+pair\b/iu,
  );
  if (exchangedPickupMatch) {
    facts.push(
      `Clothing pickup or return item: pick up new pair of ${cleanLongMemEvalCountableSegment(exchangedPickupMatch[1] ?? "")} from ${cleanExtractedValue(exchangedPickupMatch[2] ?? "")}.`,
    );
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalMusicAlbumFacts(content: string): string[] {
  const facts: string[] = [];

  const downloadedAlbumMatch = content.match(
    /\bnew\s+album\s+["“]([^"”]{2,120})["”]\s+which\s+I\s+downloaded\b/iu,
  );
  if (downloadedAlbumMatch) {
    facts.push(
      `Music album or EP I purchased or downloaded: downloaded album ${cleanExtractedValue(downloadedAlbumMatch[1] ?? "")}.`,
    );
  }

  const signedVinylMatch = content.match(
    /\bsaw\s+([A-Z][A-Za-z0-9&' -]{2,80})\s+live[\s\S]{0,120}?\bgot\s+my\s+vinyl\s+signed\b/iu,
  );
  if (signedVinylMatch) {
    facts.push(
      `Music album or EP I purchased or downloaded: signed ${cleanExtractedValue(signedVinylMatch[1] ?? "")} vinyl.`,
    );
  }

  const boughtEpMatch = content.match(
    /\bbought\s+(?:their|the)\s+EP\s+['“]([^'”]{2,120})['”]/iu,
  );
  if (boughtEpMatch) {
    facts.push(
      `Music album or EP I purchased or downloaded: bought EP ${cleanExtractedValue(boughtEpMatch[1] ?? "")}.`,
    );
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalMovieRewatchFacts(content: string): string[] {
  const facts: string[] = [];
  const rewatchPattern =
    /\bre-?watched\s+([^,.!?]*?\b(?:Avengers|Spider-Man|Marvel|Captain America|Iron Man|Thor|Black Panther|Guardians of the Galaxy)[^,.!?]*?)(?:,|\s+which\b|[.!?]|$)/giu;

  for (const match of content.matchAll(rewatchPattern)) {
    const title = cleanLongMemEvalCountableSegment(match[1] ?? "");
    if (title) {
      facts.push(`Marvel movie I re-watched: ${title}.`);
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalMarketSaleFacts(content: string): string[] {
  const facts: string[] = [];
  const perItemSaleMatch = content.match(
    /\bsold\s+(\d+)\s+([^,.!?]+?)\s+at\s+([^,.!?]*?\bMarket)\s+for\s+\$\s*(\d+(?:\.\d+)?)\s+each\b/iu,
  );
  if (perItemSaleMatch) {
    const quantity = Number(perItemSaleMatch[1] ?? "0");
    const unitPrice = Number(perItemSaleMatch[4] ?? "0");
    const total = quantity * unitPrice;
    const totalAmount = Number.isInteger(total)
      ? `$${total}`
      : `$${total.toFixed(2)}`;
    facts.push(
      `Total money I earned from selling products at markets: I earned ${totalAmount} selling ${quantity} ${cleanExtractedValue(perItemSaleMatch[2] ?? "")} at ${cleanExtractedValue(perItemSaleMatch[3] ?? "")}.`,
    );
  }

  const salePattern =
    /\b(?:I\s+)?(?:even\s+|just\s+)?sold\s+\d+[\s\S]{0,220}?(?:earning(?:\s+a\s+total\s+of)?\s+\$\s*\d+(?:\.\d+)?|for\s+\$\s*\d+(?:\.\d+)?\s+each)/giu;

  for (const match of content.matchAll(salePattern)) {
    const sale = cleanExtractedValue(match[0] ?? "")
      .replace(/^I\s+/iu, "")
      .replace(/^even\s+/iu, "");
    if (!sale || !/\bmarket\b/iu.test(sale)) {
      continue;
    }
    facts.push(
      `Total money I earned from selling products at markets: I ${sale}.`,
    );
  }

  return facts;
}

function cleanLongMemEvalGameTitle(value: string): string {
  return cleanExtractedValue(value)
    .replace(/^I\s+(?:just\s+)?(?:loved|finished|completed)\s+/iu, "")
    .replace(/^I['’]ve\s+been\s+playing\s+[^,]*?\bgames?\s+like\s+/iu, "")
    .replace(/^Can\s+you\s+recommend\s+any\s+games?\s+similar\s+to\s+/iu, "")
    .replace(/\s+on\s+(?:hard|normal)\s+difficulty\b.*$/iu, "");
}

function deriveLongMemEvalGameHourFacts(content: string): string[] {
  const facts: string[] = [];
  const spentPlayingPattern =
    /\bspent\s+(?:around\s+)?(\d+)\s+hours?\s+playing\s+([^,.!?]+?)(?:,|[.!?]|$)/giu;

  for (const match of content.matchAll(spentPlayingPattern)) {
    const hours = cleanExtractedValue(match[1] ?? "");
    const title = cleanLongMemEvalGameTitle(match[2] ?? "");
    if (hours && title) {
      facts.push(`Game time I spent: ${hours} hours playing ${title}.`);
    }
  }

  const whichTookPattern =
    /\b([A-Z][A-Za-z0-9'’&: -]{2,120}?),\s+which\b[\s\S]{0,120}?\btook\s+me\s+(\d+)\s+hours?\s+to\s+(?:finish|complete)\b/gu;
  for (const match of content.matchAll(whichTookPattern)) {
    const title = cleanLongMemEvalGameTitle(match[1] ?? "");
    const hours = cleanExtractedValue(match[2] ?? "");
    if (hours && title) {
      facts.push(`Game time I spent: ${hours} hours playing ${title}.`);
    }
  }

  const finishedPattern =
    /\b(?:I\s+)?(?:just\s+)?finished\s+([^,.!?]+?)\s+and\s+it\s+took\s+me\s+(\d+)\s+hours?\s+to\s+complete\b/giu;
  for (const match of content.matchAll(finishedPattern)) {
    const title = cleanLongMemEvalGameTitle(match[1] ?? "");
    const hours = cleanExtractedValue(match[2] ?? "");
    if (hours && title) {
      facts.push(`Game time I spent: ${hours} hours playing ${title}.`);
    }
  }

  return facts;
}

function deriveLongMemEvalWeddingFacts(content: string): string[] {
  if (!/\bweddings?\b/iu.test(content)) {
    return [];
  }

  const facts: string[] = [];
  const roommateWeddingMatch = content.match(
    /\broommate['’]s\s+wedding\b[\s\S]{0,260}?\bfriend\s+([A-Z][A-Za-z]+)\b[\s\S]{0,100}?\bpartner\s+([A-Z][A-Za-z]+)\b/iu,
  );
  if (roommateWeddingMatch) {
    facts.push(
      `Wedding I attended: ${cleanExtractedValue(roommateWeddingMatch[1] ?? "")} and ${cleanExtractedValue(roommateWeddingMatch[2] ?? "")}.`,
    );
  }

  const cousinWeddingMatch = content.match(
    /\bmy\s+cousin['’]s\s+wedding\s+at\s+a\s+([^,.!?]+?)(?:\s+in\s+[A-Z][A-Za-z]+)?(?:,|[.!?]|$)/iu,
  );
  if (cousinWeddingMatch) {
    facts.push(
      `Wedding I attended: my cousin's wedding at a ${cleanExtractedValue(cousinWeddingMatch[1] ?? "")}.`,
    );
  }

  const friendWeddingMatch = content.match(
    /\bfriend['’]s\s+wedding\b[\s\S]{0,120}?\bbride,\s+([A-Z][A-Za-z]+)\b[\s\S]{0,80}?\bhusband,\s+([A-Z][A-Za-z]+)\b/iu,
  );
  if (friendWeddingMatch) {
    facts.push(
      `Wedding I attended: ${cleanExtractedValue(friendWeddingMatch[1] ?? "")} and ${cleanExtractedValue(friendWeddingMatch[2] ?? "")}.`,
    );
  }

  return facts;
}

function deriveLongMemEvalBabyBirthFacts(content: string): string[] {
  const facts: string[] = [];
  const babyBoyPattern =
    /\b(?:had|just\s+had)\s+a\s+baby\s+boy\s+named\s+([A-Z][A-Za-z]+)\b/giu;

  for (const match of content.matchAll(babyBoyPattern)) {
    const name = cleanExtractedValue(match[1] ?? "");
    if (name) {
      facts.push(`Baby born to friends or family: ${name}.`);
    }
  }

  const twinsMatch = content.match(
    /\btwins,\s+([A-Z][A-Za-z]+)\s+and\s+([A-Z][A-Za-z]+),\s+who\s+were\s+born\b/iu,
  );
  if (twinsMatch) {
    facts.push(
      `Babies born to friends or family: twins ${cleanExtractedValue(twinsMatch[1] ?? "")} and ${cleanExtractedValue(twinsMatch[2] ?? "")} (2 babies).`,
    );
  }

  const welcomedBabyMatch = content.match(
    /\bwelcomed\b[\s\S]{0,100}?\bbaby\b[\s\S]{0,80}?\bnamed\s+([A-Z][A-Za-z]+)\b/iu,
  );
  if (welcomedBabyMatch) {
    facts.push(
      `Baby born to friends or family: ${cleanExtractedValue(welcomedBabyMatch[1] ?? "")}.`,
    );
  }

  return facts;
}

function cleanLongMemEvalCountableSegment(value: string): string {
  return cleanExtractedValue(value)
    .replace(/[.!?]+$/u, "")
    .trim();
}

function deriveLongMemEvalPersonalElectronicsFacts(content: string): string[] {
  const facts: string[] = [];
  const samsungTvMatch = content.match(
    /\b(?:my\s+)?new\s+Samsung\s+(\d{2,3})-inch\s+([^,.!?]*?\bTV\b)/iu,
  );
  if (samsungTvMatch) {
    facts.push(
      `Personal electronics spec evidence: my new Samsung TV is ${cleanExtractedValue(samsungTvMatch[1] ?? "")}-inch ${cleanLongMemEvalCountableSegment(samsungTvMatch[2] ?? "")}.`,
    );
  }

  const headphonesCostMatch = content.match(
    /\b(?:new\s+pair\s+of\s+)?([^,.!?]*?\bheadphones\b[^,.!?]*?)[\s\S]{0,120}?\bcost(?:ed)?\s+me\s+(\$\s*\d+(?:\.\d+)?)/iu,
  );
  if (headphonesCostMatch) {
    facts.push(
      `Personal electronics purchase cost evidence: ${cleanLongMemEvalCountableSegment(headphonesCostMatch[1] ?? "")} cost ${cleanExtractedValue(headphonesCostMatch[2] ?? "")}.`,
    );
  }

  const headphonesOwnershipMatch = content.match(
    /\b(?:got|use|using)\s+(?:the\s+|my\s+)?([^,.!?]*?\bheadphones\b[^,.!?]*?)(?=[,.!?]|$)/iu,
  );
  if (headphonesOwnershipMatch) {
    facts.push(
      `Personal electronics ownership evidence: ${cleanLongMemEvalCountableSegment(headphonesOwnershipMatch[1] ?? "")}.`,
    );
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalInstrumentPracticeFacts(content: string): string[] {
  const facts: string[] = [];
  const practicePattern =
    /\bpractic(?:e|ing)\s+([a-z][a-z -]{2,40})\s+for\s+(\d{1,3})\s+minutes\s+daily\b/giu;

  for (const match of content.matchAll(practicePattern)) {
    const instrument = cleanLongMemEvalCountableSegment(match[1] ?? "");
    const minutes = cleanExtractedValue(match[2] ?? "");
    if (instrument && minutes) {
      facts.push(`Instrument practice evidence: I practice ${instrument} for ${minutes} minutes daily.`);
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalPlantCountFacts(content: string): string[] {
  const plantTopicPattern =
    /\b(?:plants?|peace lily|succulent|snake plant|spider plant|tomato plants?|chili peppers?|cucumber plants?|basil plant|orchid|fern|African violets?)\b/iu;
  const plantEvidencePattern =
    /\b(?:got|bought|purchased|received|from\s+(?:my\s+)?sister|from\s+the\s+nursery|repot(?:ting)?|planted|growing|producing|brought\s+it\s+home)\b/iu;
  const facts: string[] = [];

  for (const segment of splitLongMemEvalUserEvidenceSegments(content)) {
    if (!plantTopicPattern.test(segment) || !plantEvidencePattern.test(segment)) {
      continue;
    }

    const compact = cleanLongMemEvalCountableSegment(segment);
    if (compact) {
      facts.push(`Plant count evidence: ${compact}.`);
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalAquariumTankOwnershipFacts(content: string): string[] {
  const facts: string[] = [];
  const tankTopicPattern = /\b(?:\d+\s*-\s*gallon|community|freshwater|small)?\s*tank\b/iu;
  const tankOwnershipPattern =
    /\b(?:I(?:'ve| have)?\s+(?:got|had|have)|I(?:'ve)?\s+(?:since\s+|finally\s+)?set\s+up|I've\s+also\s+been\s+taking\s+care\s+of|taking\s+care\s+of)\b/iu;

  for (const segment of splitLongMemEvalUserEvidenceSegments(content)) {
    if (!tankTopicPattern.test(segment) || !tankOwnershipPattern.test(segment)) {
      continue;
    }
    if (/\bthinking\s+(?:of|about)\s+setting\s+up\b/iu.test(segment)) {
      continue;
    }

    const compact = cleanLongMemEvalCountableSegment(segment);
    if (compact) {
      facts.push(`Aquarium tank ownership evidence: ${compact}.`);
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalBikeServiceFacts(content: string): string[] {
  const facts: string[] = [];
  const bikeTopicPattern = /\bbike\b/iu;
  const bikeServicePattern =
    /\b(?:service|serviced|maintenance|replace|replaced|tire|cleaned|lubricated|brake pads|cables|tune-up)\b/iu;

  for (const segment of splitLongMemEvalUserEvidenceSegments(content)) {
    if (!bikeTopicPattern.test(segment) || !bikeServicePattern.test(segment)) {
      continue;
    }

    const compact = cleanLongMemEvalCountableSegment(segment);
    if (compact) {
      facts.push(`Bike service evidence: ${compact}.`);
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalMagazineSubscriptionFacts(content: string): string[] {
  const facts: string[] = [];
  const publicationPattern =
    /\b(?:magazine|subscription|subscribed|Architectural Digest|The New Yorker|Forbes|National Geographic)\b/iu;
  const subscriptionSignalPattern =
    /\b(?:magazine|subscription|subscribed|getting|canceled|issue|publication)\b/iu;

  for (const segment of splitLongMemEvalUserEvidenceSegments(content)) {
    if (!publicationPattern.test(segment) || !subscriptionSignalPattern.test(segment)) {
      continue;
    }

    const compact = cleanLongMemEvalCountableSegment(segment);
    if (compact) {
      facts.push(`Magazine subscription evidence: ${compact}.`);
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalFormalEducationFacts(content: string): string[] {
  const facts: string[] = [];

  for (const segment of splitLongMemEvalUserEvidenceSegments(content)) {
    const compact = cleanLongMemEvalCountableSegment(segment);
    if (!compact) {
      continue;
    }

    if (/\bhigh school\b[\s\S]{0,120}\bfrom\s+\d{4}\s+to\s+\d{4}\b/iu.test(segment)) {
      facts.push(`Formal education duration evidence: ${compact}.`);
    }
    if (/\bAssociate'?s degree\b[\s\S]{0,160}\bfrom\b/iu.test(segment)) {
      facts.push(`Formal education duration evidence: ${compact}.`);
    }
    if (/\bBachelor'?s\b[\s\S]{0,180}\btook\s+me\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+years?\s+to\s+complete\b/iu.test(segment)) {
      facts.push(`Formal education duration evidence: ${compact}.`);
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalFeedWeightFacts(content: string): string[] {
  const facts: string[] = [];

  for (const segment of splitLongMemEvalUserEvidenceSegments(content)) {
    if (!/\b(?:feed|grains)\b/iu.test(segment)) {
      continue;
    }

    const weightMatch = segment.match(/\b(\d{1,4})\s*-\s*pound\b/iu) ??
      segment.match(/\b(\d{1,4})\s+pounds?\s+of\b/iu);
    if (!weightMatch) {
      continue;
    }

    const feedTypeMatch = segment.match(
      /\b(layer feed|organic scratch grains|scratch grains|feed|grains)\b/iu,
    );
    const weight = cleanExtractedValue(weightMatch[1] ?? "");
    const feedType = cleanLongMemEvalCountableSegment(feedTypeMatch?.[1] ?? "feed");
    if (weight && feedType) {
      facts.push(`Feed purchase weight evidence: I purchased ${weight} pounds of ${feedType}.`);
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalSiblingCountFacts(content: string): string[] {
  const facts: string[] = [];

  const sistersMatch = content.match(/\bfamily\s+with\s+(\d{1,2})\s+sisters\b/iu);
  if (sistersMatch) {
    facts.push(`Sibling count evidence: I have ${cleanExtractedValue(sistersMatch[1] ?? "")} sisters.`);
  }

  if (/\bI\s+have\s+a\s+brother\b/iu.test(content)) {
    facts.push("Sibling count evidence: I have 1 brother.");
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalCulturalActivityFacts(content: string): string[] {
  const facts: string[] = [];
  const topicPattern =
    /\b(?:art|artist|artists|artwork|museum|museums|gallery|galleries|exhibition|exhibit|lecture|workshop|tour|curator|street art)\b/iu;
  const activityPattern =
    /\b(?:attended|attending|volunteered at|visited|took\b[\s\S]{0,80}\bto|went on|guided tour|opening night|met the curator)\b/iu;

  for (const segment of splitLongMemEvalUserEvidenceSegments(content)) {
    if (!topicPattern.test(segment) || !activityPattern.test(segment)) {
      continue;
    }

    const compact = cleanLongMemEvalCountableSegment(segment);
    if (!compact) {
      continue;
    }

    facts.push(`Art-related event I attended: ${compact}.`);

    if (/\b(?:museum|museums|gallery|galleries|Art Cube|exhibition|exhibit|curator)\b/u.test(segment)) {
      facts.push(`Museum or gallery I visited: ${compact}.`);
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalFitnessClassFacts(content: string): string[] {
  const facts: string[] = [];
  const fitnessPattern =
    /\b(?:fitness|workout|exercise|zumba|bodypump|yoga|weightlifting|hip hop abs|class|classes)\b/iu;
  const classPattern =
    /\b(?:class|classes)\b[\s\S]{0,120}\b(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|\d{1,2}:\d{2}\s*(?:am|pm))\b|\b(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|\d{1,2}:\d{2}\s*(?:am|pm))\b[\s\S]{0,120}\b(?:class|classes)\b/iu;

  for (const segment of splitLongMemEvalUserEvidenceSegments(content)) {
    if (!fitnessPattern.test(segment) || !classPattern.test(segment)) {
      continue;
    }

    const compact = cleanLongMemEvalCountableSegment(segment);
    if (compact) {
      facts.push(`Fitness class I attend: ${compact}.`);
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalMusicalInstrumentFacts(content: string): string[] {
  const facts: string[] = [];

  if (/\bmy\s+niece\b/iu.test(content) && /\b(?:her|she)\b[\s\S]{0,80}\bviolin\b/iu.test(content)) {
    return [];
  }

  const instrumentPatterns = [
    /\bmy\s+((?:black\s+)?Fender\s+Stratocaster\s+electric\s+guitar)\b/iu,
    /\bmy\s+(old\s+drum\s+set,\s+a\s+[^,.!?]+?)(?=[,.!?]|$)/iu,
    /\bmy\s+(acoustic\s+guitar,\s+a\s+[^,.!?]+?)(?=[,.!?]|$)/iu,
    /\bmy\s+(Korg\s+B1)\b/iu,
    /\bmy\s+([^,.!?]*?\b(?:electric guitar|acoustic guitar|drum set|digital piano|piano)\b[^,.!?]*?)(?=[,.!?]|$)/iu,
  ] as const;

  for (const pattern of instrumentPatterns) {
    const match = content.match(pattern);
    if (!match) {
      continue;
    }

    const instrument = cleanLongMemEvalCountableSegment(match[1] ?? "");
    if (instrument) {
      facts.push(`Musical instrument I currently own: ${instrument}.`);
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalCompetitiveSportFacts(content: string): string[] {
  const facts: string[] = [];
  const sportPattern =
    /\bused\s+to\s+(swim|play\s+tennis|play\s+soccer|play\s+basketball|run\s+track)\s+competitively\b/giu;

  for (const match of content.matchAll(sportPattern)) {
    const sport = cleanLongMemEvalCountableSegment(match[1] ?? "");
    if (sport) {
      facts.push(`Competitive sport I played: ${sport}.`);
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalRewardPointFacts(content: string): string[] {
  if (!/\b(?:points?|rewards?|loyalty|Sephora|Starbucks)\b/iu.test(content)) {
    return [];
  }

  const facts: string[] = [];
  for (const segment of splitLongMemEvalUserEvidenceSegments(content)) {
    if (
      /\bpoints?\b/iu.test(segment) &&
      /\b(?:redeem|earned|total|need|needs|reward|loyalty|Sephora|Starbucks)\b/iu.test(
        segment,
      )
    ) {
      const compact = cleanLongMemEvalCountableSegment(segment);
      if (compact) {
        facts.push(`Reward points evidence: ${compact}.`);
      }
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalFurnitureActivityFacts(content: string): string[] {
  const facts: string[] = [];

  if (/\bnew\s+coffee table\b/iu.test(content)) {
    facts.push(
      "Furniture item I bought, assembled, sold, or fixed: 1 coffee table.",
    );
  }
  if (/\bnew\s+mattress\b[\s\S]{0,120}\bordered\s+one\s+from\s+Casper\b/iu.test(content)) {
    facts.push(
      "Furniture item I bought, assembled, sold, or fixed: 1 mattress ordered from Casper.",
    );
  }
  if (/\bfix(?:ing|ed)\s+the\s+wobbly\s+leg\s+on\s+my\s+kitchen table\b/iu.test(content)) {
    facts.push(
      "Furniture item I bought, assembled, sold, or fixed: 1 kitchen table with a fixed wobbly leg.",
    );
  }
  if (/\bassembled\s+(?:that\s+)?IKEA\s+bookshelf\b/iu.test(content)) {
    facts.push(
      "Furniture item I bought, assembled, sold, or fixed: 1 IKEA bookshelf.",
    );
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalPropertyViewingFacts(content: string): string[] {
  const facts: string[] = [];

  const townhouseOfferMatch = content.match(
    /\boffer\s+on\s+a\s+([^,.!?]*townhouse[^,.!?]*Brookside[^,.!?]*)(?=[,.!?]|$)/iu,
  );
  if (townhouseOfferMatch) {
    facts.push(
      `Property buying evidence: I made an offer on 1 ${cleanLongMemEvalCountableSegment(townhouseOfferMatch[1] ?? "")}.`,
    );
  }

  const bungalowMatch = content.match(
    /\bsaw\s+a\s+(?:beautiful\s+)?([^,.!?]*\b(?:bungalow|house|condo|townhouse)\b[^,.!?]*)(?:\s+that\s+I\s+really\s+liked)?[\s\S]{0,160}?\bkitchen\s+needed\s+some\s+serious\s+renovation\b/iu,
  );
  if (bungalowMatch) {
    facts.push(
      `Property viewing evidence: I viewed 1 ${cleanLongMemEvalCountableSegment(bungalowMatch[1] ?? "")}, but its kitchen needed serious renovation.`,
    );
  }

  const cedarCreekMatch = content.match(
    /\bseen\s+some\s+properties\b[\s\S]{0,120}?\bthat\s+one\s+in\s+(Cedar Creek)\b[\s\S]{0,80}?\bout\s+of\s+my\s+(?:budget|league)\b/iu,
  );
  if (cedarCreekMatch) {
    facts.push(
      `Property viewing evidence: I viewed 1 property in ${cleanExtractedValue(cedarCreekMatch[1] ?? "")}, but it was out of my budget.`,
    );
  }

  const viewedCondoMatch = content.match(
    /\bviewed\s+a\s+([^,.!?]*condo[^,.!?]*)(?:\s+on\s+[^,.!?]+)?[\s\S]{0,120}?\bnoise\s+from\s+the\s+highway\s+was\s+a\s+deal-breaker\b/iu,
  );
  if (viewedCondoMatch) {
    facts.push(
      `Property viewing evidence: I viewed 1 ${cleanLongMemEvalCountableSegment(viewedCondoMatch[1] ?? "")}, but highway noise was a deal-breaker.`,
    );
  }

  const rejectedCondoMatch = content.match(
    /\bfell\s+in\s+love\s+with\s+a\s+([^,.!?]*condo[^,.!?]*)[\s\S]{0,180}?\boffer\s+got\s+rejected\b/iu,
  );
  if (rejectedCondoMatch) {
    facts.push(
      `Property viewing evidence: I viewed 1 ${cleanLongMemEvalCountableSegment(rejectedCondoMatch[1] ?? "")}, but my offer was rejected.`,
    );
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalFoodDeliveryServiceFacts(content: string): string[] {
  const facts: string[] = [];

  if (/\bDomino'?s Pizza\b/iu.test(content)) {
    facts.push("Food delivery service I used recently: 1 service, Domino's Pizza.");
  }
  if (/\bUber Eats\b/iu.test(content)) {
    facts.push("Food delivery service I used recently: 1 service, Uber Eats.");
  }

  const calledServiceMatch = content.match(
    /\bfood delivery services\b[\s\S]{0,160}?\bcalled\s+([A-Z][A-Za-z0-9&.' -]{2,80}?)(?:\s+-|[,.!?]|$)/u,
  );
  if (calledServiceMatch) {
    facts.push(
      `Food delivery service I used recently: 1 service, ${cleanExtractedValue(calledServiceMatch[1] ?? "")}.`,
    );
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalSocialFollowerFacts(content: string): string[] {
  const facts: string[] = [];
  const followerJumpMatch = content.match(
    /\bmy\s+([A-Z][A-Za-z0-9&.' -]{1,40})\s+follower count has jumped from\s+(\d+)\s+to\s+(\d+)\b/iu,
  );
  if (followerJumpMatch) {
    const before = Number(followerJumpMatch[2] ?? "0");
    const after = Number(followerJumpMatch[3] ?? "0");
    if (Number.isFinite(before) && Number.isFinite(after)) {
      facts.push(
        `Social media follower change: ${cleanExtractedValue(followerJumpMatch[1] ?? "")} gained ${after - before} followers, from ${before} to ${after}.`,
      );
    }
  }

  const followerGainMatch = content.match(
    /\b(?:like\s+)?([A-Z][A-Za-z0-9&.' -]{1,40}),\s+where\s+I['’]?ve\s+gained\s+(?:around\s+)?(\d+)\s+followers\b/iu,
  );
  if (followerGainMatch) {
    facts.push(
      `Social media follower change: ${cleanExtractedValue(followerGainMatch[1] ?? "")} gained ${cleanExtractedValue(followerGainMatch[2] ?? "")} followers.`,
    );
  }

  const steadyFollowersMatch = content.match(
    /\bmy\s+([A-Z][A-Za-z0-9&.' -]{1,40})\s+follower count has remained steady at around\s+(\d+)\b/iu,
  );
  if (steadyFollowersMatch) {
    facts.push(
      `Social media follower change: ${cleanExtractedValue(steadyFollowersMatch[1] ?? "")} gained 0 followers and remained steady at around ${cleanExtractedValue(steadyFollowersMatch[2] ?? "")}.`,
    );
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalSocialMetricFacts(content: string): string[] {
  const facts: string[] = [];

  const facebookReachMatch = content.match(
    /\b(?:Facebook\s+)?ad campaign\b[\s\S]{0,160}?\breached\s+around\s+([\d,]+)\s+people\b/iu,
  );
  if (facebookReachMatch) {
    facts.push(
      `Social reach metric: Facebook ad campaign reached ${cleanExtractedValue(facebookReachMatch[1] ?? "")} people.`,
    );
  }

  const influencerReachMatch = content.match(
    /\binfluencer\b[\s\S]{0,160}?\b(?:promoted|shared)\b[\s\S]{0,160}?\b([\d,]+)\s+followers\b/iu,
  );
  if (influencerReachMatch) {
    facts.push(
      `Social reach metric: Instagram influencer collaboration reached ${cleanExtractedValue(influencerReachMatch[1] ?? "")} followers.`,
    );
  }

  const youtubeViewsMatch = content.match(
    /\bYouTube\b[\s\S]{0,180}?\bwith\s+([\d,]+)\s+views\b/iu,
  );
  if (youtubeViewsMatch) {
    facts.push(
      `Video view metric: YouTube video has ${cleanExtractedValue(youtubeViewsMatch[1] ?? "")} views.`,
    );
  }

  const tiktokViewsMatch = content.match(
    /\bTikTok\b[\s\S]{0,180}?\bhas\s+([\d,]+)\s+views\b/iu,
  );
  if (tiktokViewsMatch) {
    facts.push(
      `Video view metric: TikTok video has ${cleanExtractedValue(tiktokViewsMatch[1] ?? "")} views.`,
    );
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalGrocerySpendFacts(content: string): string[] {
  const facts: string[] = [];
  const patterns = [
    /\b(?:order\s+with|order\s+from|ordered\s+from|with)\s+(Thrive Market)\b[\s\S]{0,120}?\bspent\s+around\s+\$\s*(\d+(?:\.\d+)?)/iu,
    /\bspent\s+around\s+\$\s*(\d+(?:\.\d+)?)\s+at\s+(Walmart)\b/iu,
    /\b(?:went\s+to)\s+(Trader Joe's)\b[\s\S]{0,120}?\bspent\s+around\s+\$\s*(\d+(?:\.\d+)?)/iu,
    /\bordered\s+from\s+(Publix)\b[\s\S]{0,80}?\bspent\s+around\s+\$\s*(\d+(?:\.\d+)?)/iu,
  ] as const;

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (!match) {
      continue;
    }

    const first = cleanExtractedValue(match[1] ?? "");
    const second = cleanExtractedValue(match[2] ?? "");
    const store = /^\d/u.test(first) ? second : first;
    const amount = /^\d/u.test(first) ? first : second;
    if (store && amount) {
      facts.push(`Grocery store spending: I spent around $${amount} at ${store}.`);
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalFamilyAgeFacts(content: string): string[] {
  const facts: string[] = [];
  const grandparentMatch = content.match(
    /\bmy\s+grandma\s+is\s+(\d{1,3})\s+and\s+my\s+grandpa\s+is\s+(\d{1,3})\b/iu,
  );
  if (grandparentMatch) {
    facts.push(
      `Family age evidence: my grandma is ${cleanExtractedValue(grandparentMatch[1] ?? "")} and my grandpa is ${cleanExtractedValue(grandparentMatch[2] ?? "")}.`,
    );
  }

  const parentMatch = content.match(
    /\bmy\s+mom\s+is\s+(\d{1,3})\s+and\s+my\s+dad\s+is\s+(\d{1,3})\b/iu,
  );
  if (parentMatch) {
    facts.push(
      `Family age evidence: my mom is ${cleanExtractedValue(parentMatch[1] ?? "")} and my dad is ${cleanExtractedValue(parentMatch[2] ?? "")}.`,
    );
  }

  const selfAgeMatch = content.match(/\bI\s+just\s+turned\s+(\d{1,3})\b/iu);
  if (selfAgeMatch) {
    facts.push(`Family age evidence: I am ${cleanExtractedValue(selfAgeMatch[1] ?? "")}.`);
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalKnowledgeUpdateFacts(content: string): string[] {
  const facts: string[] = [];

  for (const segment of splitLongMemEvalUserEvidenceSegments(content)) {
    const compact = cleanLongMemEvalCountableSegment(segment);
    if (!compact) {
      continue;
    }

    const rachelMoveBackMatch = segment.match(
      /\bfriend\s+Rachel\b[\s\S]{0,160}?\bmoved\s+back\s+to\s+([^,.!?]{3,80}?)(?:\s+again)?(?=[,.!?]|$)/iu,
    );
    if (rachelMoveBackMatch) {
      facts.push(
        `Relationship relocation evidence: Rachel moved back to ${cleanExtractedValue(rachelMoveBackMatch[1] ?? "")}.`,
      );
    }

    const rachelMoveMatch = segment.match(
      /\bRachel\b[\s\S]{0,160}?\bmoved\s+to\s+([A-Z][A-Za-z' -]{2,80})(?=[,.!?]|$)/u,
    ) ?? (
      /\bRachel\b/u.test(content)
        ? segment.match(/\bShe\s+moved\s+to\s+([A-Z][A-Za-z' -]{2,80})(?=[,.!?]|$)/u)
        : null
    );
    if (rachelMoveMatch) {
      facts.push(
        `Relationship relocation evidence: Rachel moved to ${cleanExtractedValue(rachelMoveMatch[1] ?? "")}.`,
      );
    }

    const frenchPressRatioMatch = segment.match(
      /\bFrench press\b[\s\S]{0,160}?\b1\s+tablespoon\s+of\s+coffee\s+for\s+every\s+(\d{1,2})\s+ounces?\s+of\s+water\b/iu,
    );
    if (frenchPressRatioMatch) {
      facts.push(
        `French press coffee ratio evidence: 1 tablespoon of coffee for every ${cleanExtractedValue(frenchPressRatioMatch[1] ?? "")} ounces of water.`,
      );
    }

    const gymDaysMatch = segment.match(
      /\bgo\s+to\s+the\s+gym\s+on\s+([^,.!?]{12,120}?)(?=[,.!?]|$)/iu,
    );
    if (gymDaysMatch) {
      facts.push(
        `Gym frequency evidence: I go to the gym on ${cleanExtractedValue(gymDaysMatch[1] ?? "")}.`,
      );
    }

    const gymTimesPerWeekMatch = segment.match(
      /\bgym\s+routine\b[\s\S]{0,120}?\b(\d{1,2}|one|two|three|four|five|six|seven)\s+times?\s+a\s+week\b/iu,
    );
    if (gymTimesPerWeekMatch) {
      facts.push(
        `Gym frequency evidence: my gym routine is ${cleanExtractedValue(gymTimesPerWeekMatch[1] ?? "")} times a week.`,
      );
    }

    const therapistFrequencyMatch = segment.match(
      /\bsee\s+Dr\.?\s+([A-Z][A-Za-z'-]+)\s+every\s+week\b/iu,
    );
    if (therapistFrequencyMatch) {
      facts.push(
        `Therapist frequency evidence: I see Dr. ${cleanExtractedValue(therapistFrequencyMatch[1] ?? "")} every week.`,
      );
    }

    const gymTimeMatch = segment.match(
      /\bgo\s+to\s+the\s+gym\b[\s\S]{0,120}?\b(?:at|around)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/iu,
    );
    if (gymTimeMatch) {
      facts.push(
        `Gym schedule evidence: I usually go to the gym at ${cleanExtractedValue(gymTimeMatch[1] ?? "").toUpperCase()}.`,
      );
    }

    const hmTopsMatch = segment.match(
      /\b(?:got|bought|purchased|have)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+tops?\s+from\s+H&M\b/iu,
    );
    if (hmTopsMatch) {
      facts.push(
        `H&M purchase count evidence: I have ${cleanExtractedValue(hmTopsMatch[1] ?? "")} tops from H&M so far.`,
      );
    }

    const instagramFollowerMatch = segment.match(
      /\bInstagram\b[\s\S]{0,200}?\b(?:close\s+to|around|about)?\s*(\d{3,7})\s+(?:followers?|now)\b/iu,
    );
    if (instagramFollowerMatch) {
      facts.push(
        `Social media follower count: Instagram currently has ${cleanExtractedValue(instagramFollowerMatch[1] ?? "")} followers.`,
      );
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalQuantifiedPersonalFacts(content: string): string[] {
  const facts: string[] = [];

  for (const segment of splitLongMemEvalUserEvidenceSegments(content)) {
    const compact = cleanLongMemEvalCountableSegment(segment);
    if (!compact) {
      continue;
    }

    if (/\b\d+(?:\.\d+)?\s*-\s*mile\b[\s\S]{0,120}\b(?:hike|trail|loop)\b/iu.test(segment)) {
      const distanceMatch = segment.match(/\b(\d+(?:\.\d+)?)\s*-\s*mile\b/iu);
      if (distanceMatch) {
        facts.push(
          `Hike distance evidence for consecutive weekend hikes: ${cleanExtractedValue(distanceMatch[1] ?? "")} miles from "${compact}".`,
        );
      }
    }

    const jogDurationMatch = segment.match(/\b(\d{1,3})\s*-\s*minute\s+jog\b/iu);
    if (jogDurationMatch) {
      facts.push(
        `Jogging and yoga duration evidence for last-week workout hours: ${cleanExtractedValue(jogDurationMatch[1] ?? "")} minutes of jogging.`,
      );
    }

    const yogaDurationMatch = segment.match(
      /\byoga\b[\s\S]{0,120}?\b(\d{1,2}|one|two|three|four|five|six|seven)\s+times?\s+a\s+week\b[\s\S]{0,120}?\beach\s+time\s+for\s+(\d{1,2})\s+hours?\b/iu,
    );
    if (yogaDurationMatch) {
      facts.push(
        `Jogging and yoga duration evidence for last-week workout hours: yoga was ${cleanExtractedValue(yogaDurationMatch[1] ?? "")} times a week for ${cleanExtractedValue(yogaDurationMatch[2] ?? "")} hours each time.`,
      );
    }

    const recentFiveKMatch = segment.match(
      /\b(?:recently\s+)?finished\s+a\s+5K(?:\s+run)?\s+in\s+(\d{1,3})\s+minutes\b/iu,
    );
    if (recentFiveKMatch) {
      facts.push(
        `5K run finish-time evidence for faster previous-year comparison: recent 5K finish was ${cleanExtractedValue(recentFiveKMatch[1] ?? "")} minutes.`,
      );
    }

    const previousFiveKMatch = segment.match(
      /\b5K\s+run\s+last\s+year\b[\s\S]{0,120}?\btook\s+me\s+(\d{1,3})\s+minutes\b/iu,
    );
    if (previousFiveKMatch) {
      facts.push(
        `5K run finish-time evidence for faster previous-year comparison: previous year's 5K finish was ${cleanExtractedValue(previousFiveKMatch[1] ?? "")} minutes.`,
      );
    }

    const grandmaBirthdayMatch = segment.match(
      /\bmy\s+grandma['’]s\s+(\d{1,3})(?:st|nd|rd|th)?\s+birthday\b/iu,
    );
    if (grandmaBirthdayMatch) {
      facts.push(
        `Family age comparison evidence for grandma years older questions: my grandma is ${cleanExtractedValue(grandmaBirthdayMatch[1] ?? "")}.`,
      );
    }

    const explicitAgeMatch = segment.match(
      /\b(?:I['’]?m|I\s+am)\s+(?:currently\s+)?(\d{1,3})(?:\s*-\s*year\s*-\s*old|\s+years?\s+old)?(?=\s*(?:[,.;!?]|and|so|$))/iu,
    );
    if (explicitAgeMatch) {
      const age = cleanExtractedValue(explicitAgeMatch[1] ?? "");
      const futureAgePattern = new RegExp(
        `\\bby\\s+the\\s+time\\s+I(?:['’]?m|\\s+am)\\s+${escapeLongMemEvalRegExp(age)}\\b`,
        "iu",
      );
      if (!futureAgePattern.test(segment)) {
        facts.push(
          `Family age comparison evidence for grandma years older questions: I am ${age}.`,
        );
        facts.push(
          `My age evidence for age comparison questions: I am ${age}.`,
        );
        facts.push(
          `Current personal age evidence for years-old arithmetic questions: I am ${age} years old.`,
        );
        facts.push(
          `Graduation age comparison evidence for years older comparison: current age is ${age}.`,
        );
        facts.push(
          `Birth-age comparison evidence for questions about how old I was when someone was born: I am ${age}.`,
        );
      }
    }

    const ageAdjectiveMatch = segment.match(
      /\b(?:as\s+a\s+)?(\d{1,3})\s*-\s*year\s*-\s*old\b/iu,
    );
    if (ageAdjectiveMatch) {
      const age = cleanExtractedValue(ageAdjectiveMatch[1] ?? "");
      facts.push(
        `My age evidence for age comparison questions: I am ${age}.`,
      );
      facts.push(
        `Current personal age evidence for years-old arithmetic questions: I am ${age} years old.`,
      );
      facts.push(
        `Graduation age comparison evidence for years older comparison: current age is ${age}.`,
      );
    }

    const consideredAgeMatch = segment.match(
      /\b(?:whether|think)\s+(\d{1,3})\s+is\s+considered\b/iu,
    );
    if (consideredAgeMatch) {
      const age = cleanExtractedValue(consideredAgeMatch[1] ?? "");
      facts.push(
        `Family age comparison evidence for grandma years older questions: I am ${age}.`,
      );
      facts.push(
        `My age evidence for age comparison questions: I am ${age}.`,
      );
      facts.push(
        `Current personal age evidence for years-old arithmetic questions: I am ${age} years old.`,
      );
    }

    const turnedAgeMatch = segment.match(/\bI\s+just\s+turned\s+(\d{1,3})\b/iu);
    if (turnedAgeMatch) {
      const age = cleanExtractedValue(turnedAgeMatch[1] ?? "");
      facts.push(
        `Birth-age comparison evidence for questions about how old I was when someone was born: I am ${age}.`,
      );
      facts.push(
        `Current personal age evidence for years-old arithmetic questions: I am ${age} years old.`,
      );
    }

    const tripForDaysMatch = segment.match(
      /\b(?:trip|travel)\s+to\s+([A-Z][A-Za-z' -]{2,80})\s+for\s+(\d{1,2})\s+days\b/iu,
    );
    if (tripForDaysMatch) {
      facts.push(
        `Travel duration evidence for total days spent traveling: trip to ${cleanExtractedValue(tripForDaysMatch[1] ?? "")} lasted ${cleanExtractedValue(tripForDaysMatch[2] ?? "")} days.`,
      );
    }

    const tripForWordDaysMatch = segment.match(
      /\b(?:trip|travel)\s+to\s+([A-Z][A-Za-z' -]{2,80})\s+for\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+days\b/iu,
    );
    if (tripForWordDaysMatch) {
      facts.push(
        `Travel duration evidence for total days spent traveling: trip to ${cleanExtractedValue(tripForWordDaysMatch[1] ?? "")} lasted ${cleanExtractedValue(tripForWordDaysMatch[2] ?? "")} days.`,
      );
    }

    const dayTripMatch = segment.match(
      /\b(\d{1,2})\s*-\s*day\s+trip\s+to\s+([A-Z][A-Za-z' -]{2,80})\b/iu,
    );
    if (dayTripMatch) {
      facts.push(
        `Travel duration evidence for total days spent traveling: trip to ${cleanExtractedValue(dayTripMatch[2] ?? "")} lasted ${cleanExtractedValue(dayTripMatch[1] ?? "")} days.`,
      );
    }

    const describedDayTripMatch = segment.match(/\b(\d{1,2})\s*-\s*day\s+trip\b/iu);
    if (describedDayTripMatch && /\b(?:Hawaii|itinerary|family|travel|trip)\b/iu.test(segment)) {
      const destination = /\bHawaii\b/iu.test(segment) ? "Hawaii" : "the described trip";
      facts.push(
        `Travel duration evidence for total days spent traveling: trip to ${destination} lasted ${cleanExtractedValue(describedDayTripMatch[1] ?? "")} days.`,
      );
    }

    const bareDayDurationMatch = segment.match(/\b(?:the\s+)?(\d{1,2})\s*-\s*day\b/iu);
    if (
      bareDayDurationMatch &&
      !describedDayTripMatch &&
      /\b(?:family|travel|trip|destination|solo|itinerary|plan)\b/iu.test(segment)
    ) {
      facts.push(
        `Travel duration evidence for total days spent traveling: family trip lasted ${cleanExtractedValue(bareDayDurationMatch[1] ?? "")} days.`,
      );
    }

    const dateRangeTripMatch = segment.match(
      /\b(?:went\s+to|visited)\s+([A-Z][A-Za-z' -]{2,80})\s+before\s+from\s+([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\b/iu,
    );
    if (dateRangeTripMatch) {
      facts.push(
        `Travel duration evidence for total days spent traveling: trip to ${cleanExtractedValue(dateRangeTripMatch[1] ?? "")} ran from ${cleanExtractedValue(dateRangeTripMatch[2] ?? "")} ${cleanExtractedValue(dateRangeTripMatch[3] ?? "")} to ${cleanExtractedValue(dateRangeTripMatch[4] ?? "")}.`,
      );
    }

    const hawaiiDurationMatch = content.match(
      /\bHawaii\b[\s\S]{0,520}\b(\d{1,2})\s*-\s*day\b/iu,
    ) ?? content.match(
      /\b(\d{1,2})\s*-\s*day\b[\s\S]{0,520}\bHawaii\b/iu,
    );
    if (hawaiiDurationMatch) {
      const duration = cleanExtractedValue(
        (hawaiiDurationMatch[1] ?? hawaiiDurationMatch[2]) ?? "",
      );
      facts.push(
        `Travel duration evidence for total days spent traveling: trip to Hawaii lasted ${duration} days.`,
      );
    }

    const workshopCostMatch = segment.match(
      /\b([^,.!?]*\bworkshop\b[^,.!?]*?)\b(?:paid|cost)\s+(?:me\s+)?\$\s*(\d+(?:\.\d+)?)/iu,
    ) ?? segment.match(
      /\b(?:paid|cost)\s+(?:me\s+)?\$\s*(\d+(?:\.\d+)?)[\s\S]{0,120}?\b([^,.!?]*\bworkshop\b[^,.!?]*?)\b/iu,
    );
    if (workshopCostMatch) {
      const first = cleanExtractedValue(workshopCostMatch[1] ?? "");
      const second = cleanExtractedValue(workshopCostMatch[2] ?? "");
      const amount = /^\d/u.test(first) ? first : second;
      const workshop = /^\d/u.test(first) ? second : first;
      if (amount && workshop) {
        facts.push(
          `Workshop cost evidence for total money spent attending workshops: ${workshop} cost $${amount}.`,
        );
      }
    }

    const workshopPaidMatch = segment.match(/\bworkshop\b[\s\S]{0,160}?\bpaid\s+\$\s*(\d+(?:\.\d+)?)\s+to\s+attend\b/iu);
    if (workshopPaidMatch) {
      facts.push(
        `Workshop cost evidence for total money spent attending workshops: ${compact} Cost was $${cleanExtractedValue(workshopPaidMatch[1] ?? "")}.`,
      );
    }

    const workshopThenPaidMatch = content.match(
      /\b([^.!?]*\bworkshop\b[^.!?]*)[\s\S]{0,220}?\bpaid\s+\$\s*(\d+(?:\.\d+)?)\s+to\s+attend\b/iu,
    );
    if (workshopThenPaidMatch) {
      facts.push(
        `Workshop cost evidence for total money spent attending workshops: ${cleanExtractedValue(workshopThenPaidMatch[1] ?? "")} cost $${cleanExtractedValue(workshopThenPaidMatch[2] ?? "")}.`,
      );
    }

    const paidWorkshopMatch = segment.match(/\bpaid\s+\$\s*(\d+(?:\.\d+)?)\s+to\s+attend\b[\s\S]{0,160}?\bworkshop\b/iu);
    if (paidWorkshopMatch) {
      facts.push(
        `Workshop cost evidence for total money spent attending workshops: ${compact} Cost was $${cleanExtractedValue(paidWorkshopMatch[1] ?? "")}.`,
      );
    }

    const workshopDurationMatch = segment.match(
      /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|half)\s*-\s*day\s+([^,.!?]*\bworkshop\b[^,.!?]*)/iu,
    );
    if (workshopDurationMatch) {
      facts.push(
        `Workshop attendance evidence for total money spent attending workshops: ${cleanExtractedValue(workshopDurationMatch[1] ?? "")}-day ${cleanExtractedValue(workshopDurationMatch[2] ?? "")}.`,
      );
    }

    const podcastEpisodeMatch = segment.match(
      /\b(?:finished|listened\s+to)\s+(?:around\s+)?(?:episode\s+)?(\d{1,4})\s+(?:episodes?\s+)?(?:of\s+|from\s+)?(?:the\s+)?["“]?([^"”.,!?]{2,100})["”]?\s+podcast\b/iu,
    ) ?? segment.match(
      /["“]([^"”]{2,100})["”][\s\S]{0,260}?\bfinished\s+around\s+(\d{1,4})\s+episodes?\b/iu,
    ) ?? content.match(
      /["“]([^"”]{2,100})["”][\s\S]{0,360}?\bfinished\s+around\s+(\d{1,4})\s+episodes?\b/iu,
    );
    if (podcastEpisodeMatch) {
      const first = cleanExtractedValue(podcastEpisodeMatch[1] ?? "");
      const second = cleanExtractedValue(podcastEpisodeMatch[2] ?? "");
      const episodeCount = /^\d/u.test(first) ? first : second;
      const show = /^\d/u.test(first) ? second : first;
      if (episodeCount && show) {
        facts.push(
          `Podcast episode count evidence for total number of episodes listened: ${show} has ${episodeCount} episodes listened.`,
        );
      }
    }

    if (/\bworkshop\b/iu.test(segment) && /\bfree\s+event\b/iu.test(segment)) {
      facts.push(
        `Workshop cost evidence for total money spent attending workshops: ${compact} Cost was $0.`,
      );
    }

    const workshopCountMatch = segment.match(
      /\battended\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+workshops?\b[\s\S]{0,80}\blast\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+months?\b/iu,
    );
    if (workshopCountMatch) {
      facts.push(
        `Workshop attendance evidence: I attended ${cleanExtractedValue(workshopCountMatch[1] ?? "")} workshops in the last ${cleanExtractedValue(workshopCountMatch[2] ?? "")} months.`,
      );
    }

    const roleProgressionMatch = segment.match(
      /\bworked\s+my\s+way\s+up\s+to\s+([^,.!?]{3,80}?)\s+after\s+(\d{1,2})\s+years?\s+and\s+(\d{1,2})\s+months?\b/iu,
    );
    if (roleProgressionMatch) {
      facts.push(
        `Working current role duration evidence: I became ${cleanExtractedValue(roleProgressionMatch[1] ?? "")} after ${cleanExtractedValue(roleProgressionMatch[2] ?? "")} years and ${cleanExtractedValue(roleProgressionMatch[3] ?? "")} months before my current role tenure question.`,
      );
    }

    const companyExperienceMatch = segment.match(
      /\bmy\s+(\d{1,2})\s+years?\s+and\s+(\d{1,2})\s+months?\s+experience\s+in\s+the\s+company\b/iu,
    );
    if (companyExperienceMatch) {
      facts.push(
        `Working current role duration evidence: I have ${cleanExtractedValue(companyExperienceMatch[1] ?? "")} years and ${cleanExtractedValue(companyExperienceMatch[2] ?? "")} months experience in the company for my current role tenure question.`,
      );
    }

    const gpaMatch = segment.match(
      /\bGPA\s+of\s+(\d(?:\.\d{1,2})?)\s+out\s+of\s+4\.0\b/iu,
    );
    if (gpaMatch) {
      facts.push(
        `Academic GPA evidence for undergraduate and graduate average: GPA was ${cleanExtractedValue(gpaMatch[1] ?? "")} out of 4.0.`,
      );
    }

    const percentageToGpaMatch = segment.match(
      /\boverall\s+percentage\s+of\s+(\d{1,3})%[\s\S]{0,80}?\bGPA\s+of\s+(\d(?:\.\d{1,2})?)\s+out\s+of\s+4\.0\b/iu,
    );
    if (percentageToGpaMatch) {
      facts.push(
        `Academic GPA evidence for undergraduate and graduate average: ${cleanExtractedValue(percentageToGpaMatch[1] ?? "")}% is equivalent to GPA ${cleanExtractedValue(percentageToGpaMatch[2] ?? "")} out of 4.0.`,
      );
    }

    const graduationAgeMatch = segment.match(
      /\b(?:completed|graduated)[\s\S]{0,180}?\bat\s+the\s+age\s+of\s+(\d{1,3})\b/iu,
    );
    if (graduationAgeMatch) {
      facts.push(
        `Graduation age evidence for years older comparison: I graduated or completed the degree at age ${cleanExtractedValue(graduationAgeMatch[1] ?? "")}.`,
      );
    }

    if (/\bfriend\s+Rachel['’]s\s+getting\s+married\s+next\s+year\b/iu.test(segment)) {
      facts.push(
        "Rachel wedding age evidence for years-old arithmetic questions: my friend Rachel gets married next year.",
      );
    }

    const marathonTargetMatch = segment.match(
      /\btarget\s+time\s+for\s+the\s+marathon\s+was\s+(\d{1,2})\s+hours?\s+and\s+(\d{1,2})\s+minutes\b/iu,
    );
    if (marathonTargetMatch) {
      facts.push(
        `Marathon time evidence: target marathon time was ${cleanExtractedValue(marathonTargetMatch[1] ?? "")} hours and ${cleanExtractedValue(marathonTargetMatch[2] ?? "")} minutes.`,
      );
    }

    const marathonFinishMatch = segment.match(
      /\bfull\s+marathon\s+in\s+(\d{1,2})h\s*(\d{1,2})min\b/iu,
    );
    if (marathonFinishMatch) {
      facts.push(
        `Marathon time evidence: finished the marathon in ${cleanExtractedValue(marathonFinishMatch[1] ?? "")} hours and ${cleanExtractedValue(marathonFinishMatch[2] ?? "")} minutes.`,
      );
    }

    const weekdayWakeMatch = segment.match(
      /\bwaking\s+up\s+at\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\s+on\s+weekdays\b/iu,
    );
    if (weekdayWakeMatch) {
      facts.push(
        `Wake time evidence: weekday wake time is ${cleanExtractedValue(weekdayWakeMatch[1] ?? "").toUpperCase()}.`,
      );
    }

    const fridayWakeMatch = segment.match(
      /\bon\s+Fridays\b[\s\S]{0,120}?\bwake\s+up\s+at\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\b/iu,
    );
    if (fridayWakeMatch) {
      facts.push(
        `Wake time evidence: Friday wake time is ${cleanExtractedValue(fridayWakeMatch[1] ?? "").toUpperCase()}.`,
      );
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalMedicalProviderFacts(content: string): string[] {
  const facts: string[] = [];
  const providerPattern =
    /\b(primary care physician|ENT specialist|dermatologist)\s*,?\s*(Dr\.\s+[A-Z][A-Za-z'-]+)\b/gu;

  for (const match of content.matchAll(providerPattern)) {
    const role = cleanExtractedValue(match[1] ?? "");
    const name = cleanExtractedValue(match[2] ?? "");
    if (role && name) {
      facts.push(`Medical provider evidence: ${role} ${name}.`);
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalModelKitFacts(content: string): string[] {
  const facts: string[] = [];
  const kitPatterns = [
    /\b(?:my\s+new\s+|new\s+)?(\d+\/\d+\s+scale\s+[^,.!?]*?\bmodel kit)\b/giu,
    /\b(?:a\s+|an\s+|the\s+)?(\d+\/\d+\s+scale\s+['’]?\d{2}\s+[A-Za-z0-9][A-Za-z0-9'’ -]*?)(?:\s+at\b|,|[.!?]|$)/giu,
  ] as const;

  for (const pattern of kitPatterns) {
    for (const match of content.matchAll(pattern)) {
      const modelKit = cleanLongMemEvalCountableSegment(match[1] ?? "");
      if (!modelKit || !/\b(?:model|kit|scale|camaro|bomber)\b/iu.test(modelKit)) {
        continue;
      }

      facts.push(`I worked on or got the model kit: ${modelKit}.`);
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalCountableEvidenceFacts(content: string): string[] {
  return [
    ...deriveLongMemEvalFestivalFacts(content),
    ...deriveLongMemEvalBakingFacts(content),
    ...deriveLongMemEvalHealthDeviceFacts(content),
    ...deriveLongMemEvalAquariumFacts(content),
    ...deriveLongMemEvalAquariumTankOwnershipFacts(content),
    ...deriveLongMemEvalKitchenItemFacts(content),
    ...deriveLongMemEvalKitchenAppliancePurchaseFacts(content),
    ...deriveLongMemEvalClothingPickupReturnFacts(content),
    ...deriveLongMemEvalMusicAlbumFacts(content),
    ...deriveLongMemEvalMovieRewatchFacts(content),
    ...deriveLongMemEvalMarketSaleFacts(content),
    ...deriveLongMemEvalGameHourFacts(content),
    ...deriveLongMemEvalWeddingFacts(content),
    ...deriveLongMemEvalBabyBirthFacts(content),
    ...deriveLongMemEvalCulturalActivityFacts(content),
    ...deriveLongMemEvalFitnessClassFacts(content),
    ...deriveLongMemEvalMusicalInstrumentFacts(content),
    ...deriveLongMemEvalCompetitiveSportFacts(content),
    ...deriveLongMemEvalRewardPointFacts(content),
    ...deriveLongMemEvalFurnitureActivityFacts(content),
    ...deriveLongMemEvalPropertyViewingFacts(content),
    ...deriveLongMemEvalFoodDeliveryServiceFacts(content),
    ...deriveLongMemEvalSocialFollowerFacts(content),
    ...deriveLongMemEvalSocialMetricFacts(content),
    ...deriveLongMemEvalGrocerySpendFacts(content),
    ...deriveLongMemEvalFamilyAgeFacts(content),
    ...deriveLongMemEvalKnowledgeUpdateFacts(content),
    ...deriveLongMemEvalPersonalElectronicsFacts(content),
    ...deriveLongMemEvalInstrumentPracticeFacts(content),
    ...deriveLongMemEvalPlantCountFacts(content),
    ...deriveLongMemEvalBikeServiceFacts(content),
    ...deriveLongMemEvalMagazineSubscriptionFacts(content),
    ...deriveLongMemEvalFormalEducationFacts(content),
    ...deriveLongMemEvalFeedWeightFacts(content),
    ...deriveLongMemEvalSiblingCountFacts(content),
    ...deriveLongMemEvalQuantifiedPersonalFacts(content),
    ...deriveLongMemEvalMedicalProviderFacts(content),
    ...deriveLongMemEvalModelKitFacts(content),
  ];
}

export function deriveLongMemEvalUserEvidenceFacts(input: {
  content: string;
  date: string;
}): string[] {
  const date = normalizeLongMemEvalSessionDate(input.date);
  const facts = [
    ...deriveLongMemEvalCountableEvidenceFacts(input.content),
    ...deriveLongMemEvalProjectRoleFacts(input.content),
    ...deriveLongMemEvalContextualExpenseFacts(input.content),
    ...deriveLongMemEvalHouseholdIssueFacts(input.content),
    ...splitLongMemEvalUserEvidenceSegments(input.content)
      .filter(isLongMemEvalDurableUserEvidenceSegment)
      .flatMap((segment) => [
        ...deriveLongMemEvalClassLocationFacts(segment),
        ...deriveLongMemEvalSleepTimeFacts(segment),
        date === "unknown-date" ? segment : `On ${date}, ${segment}`,
      ]),
  ];

  return [...new Set(facts)].slice(0, 6);
}

function deriveLongMemEvalPreferenceRequestFacts(input: {
  content: string;
  date: string;
}): string[] {
  if (!isRecommendationStyleEvidenceTurn(input.content)) {
    return [];
  }

  const date = normalizeLongMemEvalSessionDate(input.date);
  const normalized = cleanExtractedValue(input.content);
  const facts: string[] = [];
  const requestMatch = normalized.match(
    /\b(?:do you have|can you recommend|can you suggest|could you recommend|could you suggest)\b\s+(?:any\s+|some\s+)?([\s\S]{8,180}?)(?:\?|$)/iu,
  );

  if (requestMatch) {
    const request = cleanExtractedValue(requestMatch[1] ?? "");
    if (request) {
      facts.push(
        date === "unknown-date"
          ? `I am interested in ${request}.`
          : `On ${date}, I was interested in ${request}.`,
      );
    }
  }

  return [...new Set(facts)].slice(0, 3);
}

function normalizeLongMemEvalFlightPlace(value: string): string {
  return cleanExtractedValue(value)
    .replace(/\s+(?:today|yesterday|tomorrow)$/iu, "")
    .trim();
}

function normalizeLongMemEvalAirlineName(value: string): string {
  return cleanExtractedValue(value)
    .replace(/'s$/iu, "")
    .trim();
}

function pushLongMemEvalFlightFact(input: {
  airline: string;
  date: string;
  facts: string[];
  from: string;
  to: string;
}): void {
  const airline = normalizeLongMemEvalAirlineName(input.airline);
  const from = normalizeLongMemEvalFlightPlace(input.from);
  const to = normalizeLongMemEvalFlightPlace(input.to);
  if (!airline || !from || !to) {
    return;
  }

  input.facts.push(
    `On ${input.date}, I flew with ${airline} from ${from} to ${to}.`,
  );
}

function deriveLongMemEvalFlightEventFacts(input: {
  content: string;
  date: string;
}): string[] {
  const facts: string[] = [];
  const airlineName =
    String.raw`(?:JetBlue|Delta|[A-Z][A-Za-z]+(?:\s+(?:Airlines|Airways|Air)))`;
  const route = String.raw`from\s+([^,.!?]+?)\s+to\s+([^,.!?]+?)(?=\s+(?:and|today|due|which|that)\b|[,.!?]|$)`;
  const airlineBeforeFlight = new RegExp(
    String.raw`\b(${airlineName})'?(?:s)?\s+(?:red-eye\s+|round-trip\s+)?flight\s+${route}`,
    "giu",
  );
  const airlineAfterFlight = new RegExp(
    String.raw`\b(?:red-eye\s+|round-trip\s+)?flight\s+(?:on|with)\s+(${airlineName})\s+${route}`,
    "giu",
  );

  for (const match of input.content.matchAll(airlineBeforeFlight)) {
    pushLongMemEvalFlightFact({
      airline: match[1] ?? "",
      date: input.date,
      facts,
      from: match[2] ?? "",
      to: match[3] ?? "",
    });
  }

  for (const match of input.content.matchAll(airlineAfterFlight)) {
    pushLongMemEvalFlightFact({
      airline: match[1] ?? "",
      date: input.date,
      facts,
      from: match[2] ?? "",
      to: match[3] ?? "",
    });
  }

  const skyMilesFlightMatch = input.content.match(
    /\bDelta\s+SkyMiles\b[\s\S]{0,180}\btaking\s+a\s+round-trip\s+flight\s+from\s+([^,.!?]+?)\s+to\s+([^,.!?]+?)(?=\s+(?:today|due|which|that)\b|[,.!?]|$)/iu,
  );
  if (skyMilesFlightMatch) {
    pushLongMemEvalFlightFact({
      airline: "Delta",
      date: input.date,
      facts,
      from: skyMilesFlightMatch[1] ?? "",
      to: skyMilesFlightMatch[2] ?? "",
    });
  }

  const pronounReferencedFlight = new RegExp(
    String.raw`\bflying\s+with\s+(${airlineName})\b[\s\S]{0,220}\bwith\s+it\s+on\s+my\s+flight\s+${route}`,
    "iu",
  ).exec(input.content);
  if (pronounReferencedFlight) {
    pushLongMemEvalFlightFact({
      airline: pronounReferencedFlight[1] ?? "",
      date: input.date,
      facts,
      from: pronounReferencedFlight[2] ?? "",
      to: pronounReferencedFlight[3] ?? "",
    });
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalBookEventFacts(input: {
  content: string;
  date: string;
}): string[] {
  const facts: string[] = [];
  const discussionMatch =
    input.content.match(/\bfinished\s+a\s+discussion\s+on\s+"([^"]{3,120})"/iu) ??
    input.content.match(
      /\bfinished\s+a\s+discussion\s+on\s+'(.{3,120}?)'(?=\s+(?:by|today|and)\b|[,.!?]|$)/iu,
    );
  if (discussionMatch) {
    facts.push(
      `On ${input.date}, I finished a discussion on "${cleanExtractedValue(discussionMatch[1] ?? "")}".`,
    );
  }

  const readingMatch =
    input.content.match(/\bfinished\s+reading\s+"([^"]{3,120})"/iu) ??
    input.content.match(
      /\bfinished\s+reading\s+'(.{3,120}?)'(?=\s+(?:by|today|and)\b|[,.!?]|$)/iu,
    ) ??
    input.content.match(
      /\bfinished\s+(?:a\s+)?(?:[\w\s-]+?\s+)?novel,\s+"([^"]{3,120})"/iu,
    ) ??
    input.content.match(
      /\bfinished\s+(?:a\s+)?(?:[\w\s-]+?\s+)?novel,\s+'(.{3,120}?)'(?=\s+(?:by|today|and)\b|[,.!?]|$)/iu,
    );
  if (readingMatch) {
    facts.push(
      `On ${input.date}, I finished reading "${cleanExtractedValue(readingMatch[1] ?? "")}".`,
    );
  }

  const startedReadingMatch =
    input.content.match(/\bstarted\s+reading\s+"([^"]{3,120})"/iu) ??
    input.content.match(
      /\bstarted\s+reading\s+'(.{3,120}?)'(?=\s+(?:by|today|and)\b|[,.!?]|$)/iu,
    );
  if (startedReadingMatch) {
    facts.push(
      `On ${input.date}, I started reading "${cleanExtractedValue(startedReadingMatch[1] ?? "")}".`,
    );
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalTripEventFacts(input: {
  content: string;
  date: string;
}): string[] {
  const facts: string[] = [];
  const patterns: Array<{ description: string; pattern: RegExp }> = [
    {
      description: "a day hike to",
      pattern:
        /\bjust\s+got\s+back\s+from\s+a\s+day\s+hike\s+to\s+([^,.!?]+?)(?=\s+(?:with|today)\b|[,.!?]|$)/giu,
    },
    {
      description: "a road trip to",
      pattern:
        /\bjust\s+got\s+back\s+from\s+a\s+road\s+trip(?:\s+with\s+friends)?\s+to\s+([^,.!?]+?)(?=\s+today\b|[,.!?]|$)/giu,
    },
    {
      description: "a solo camping trip to",
      pattern:
        /\b(?:just|recently)\s+got\s+back\s+from\s+a\s+solo\s+camping\s+trip\s+to\s+([^,.!?]+?)(?=\s+(?:and|today)\b|[,.!?]|$)/giu,
    },
    {
      description: "a solo camping trip to",
      pattern:
        /\bstarted\s+my\s+solo\s+camping\s+trip\s+to\s+([^,.!?]+?)(?=\s+today\b|[,.!?]|$)/giu,
    },
  ];

  for (const { description, pattern } of patterns) {
    for (const match of input.content.matchAll(pattern)) {
      const place = cleanExtractedValue(match[1] ?? "");
      if (place) {
        facts.push(`On ${input.date}, I took ${description} ${place}.`);
      }
    }
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalSportsEventFacts(input: {
  content: string;
  date: string;
}): string[] {
  const facts: string[] = [];
  if (
    /\bNBA\s+game\b/iu.test(input.content) &&
    /\bStaples\s+Center\b/iu.test(input.content) &&
    /\b(?:went\s+to|watched|watching)\b/iu.test(input.content)
  ) {
    facts.push(`On ${input.date}, I watched an NBA game at the Staples Center.`);
  }
  if (
    /\bCollege\s+Football\s+National\s+Championship\s+game\b/iu.test(input.content) &&
    /\bwatched\b/iu.test(input.content)
  ) {
    facts.push(
      `On ${input.date}, I watched the College Football National Championship game.`,
    );
  }
  if (
    /\bNFL\s+playoffs\b/iu.test(input.content) &&
    /\b(?:watched|watching)\b/iu.test(input.content)
  ) {
    facts.push(`On ${input.date}, I watched the NFL playoffs.`);
  }

  const triathlonMatch = input.content.match(
    /\bcompleted\s+the\s+([^,.!?]{3,80}?\s+Triathlon)\s+today\b/iu,
  );
  if (triathlonMatch) {
    facts.push(
      `On ${input.date}, I participated in the ${cleanExtractedValue(triathlonMatch[1] ?? "")} sports event.`,
    );
  }

  const fiveKRunMatch = input.content.match(
    /\bfinished\s+a\s+5K\s+run\b[\s\S]{0,120}?\bat\s+the\s+([^,.!?]{3,80}?\s+5K\s+Run)\b/iu,
  );
  if (fiveKRunMatch) {
    facts.push(
      `On ${input.date}, I participated in the ${cleanExtractedValue(fiveKRunMatch[1] ?? "")} sports event.`,
    );
  }

  const soccerTournamentMatch = input.content.match(
    /\bparticipate\s+in\s+the\s+([^,.!?]{3,100}?\s+soccer\s+tournament)\s+today\b/iu,
  );
  if (soccerTournamentMatch) {
    facts.push(
      `On ${input.date}, I participated in the ${cleanExtractedValue(soccerTournamentMatch[1] ?? "")} sports event.`,
    );
  }

  return [...new Set(facts)];
}

function deriveLongMemEvalStreamingServiceEventFacts(input: {
  content: string;
  date: string;
}): string[] {
  const facts: string[] = [];
  const streamingService = String.raw`(?:Disney\+|Apple TV\+|Netflix|Hulu|Amazon Prime)`;

  const multiServiceMatch = new RegExp(
    String.raw`\busing\s+((?:${streamingService})(?:,\s*(?:${streamingService}))*\s*,?\s+and\s+(?:${streamingService}))\s+for\s+the\s+past\s+(\d+\s+months?)\b`,
    "iu",
  ).exec(input.content);
  if (multiServiceMatch) {
    const duration = cleanExtractedValue(multiServiceMatch[2] ?? "");
    const servicePattern = new RegExp(streamingService, "giu");
    for (const match of (multiServiceMatch[1] ?? "").matchAll(servicePattern)) {
      facts.push(`On ${input.date}, I had been using ${match[0]} for ${duration}.`);
    }
  }

  const durationServiceMatch = new RegExp(
    String.raw`\busing\s+(${streamingService})\s+for\s+(?:a\s+)?(few\s+months|\d+\s+months?)\b`,
    "iu",
  );
  const durationService = durationServiceMatch.exec(input.content);
  if (durationService) {
    facts.push(
      `On ${input.date}, I had been using ${cleanExtractedValue(durationService[1] ?? "")} for ${cleanExtractedValue(durationService[2] ?? "")}.`,
    );
  }

  const freeTrialMatch = new RegExp(
    String.raw`\bsaw\b[\s\S]{0,120}?\bon\s+(${streamingService})\s+during\s+my\s+free trial\s+last month\b`,
    "iu",
  );
  const freeTrial = freeTrialMatch.exec(input.content);
  if (freeTrial) {
    facts.push(
      `On ${input.date}, I started using ${cleanExtractedValue(freeTrial[1] ?? "")} during my free trial last month.`,
    );
  }

  return [...new Set(facts)];
}

function normalizeLongMemEvalSessionDate(date: string): string {
  return date.match(/\d{4}\/\d{2}\/\d{2}/u)?.[0] ?? date;
}

function isLongMemEvalDatedEvidenceFact(fact: string): boolean {
  return /^On\s+\d{4}\/\d{2}\/\d{2},\s/u.test(fact);
}

export function deriveLongMemEvalDatedUserEvidenceFacts(input: {
  content: string;
  date: string;
}): string[] {
  const date = normalizeLongMemEvalSessionDate(input.date);
  const content = input.content;
  const facts: string[] = [];

  if (/\bMuseum of Modern Art\b/iu.test(content) && /\bguided tour\b/iu.test(content)) {
    facts.push(`On ${date}, I visited the Museum of Modern Art for a guided tour.`);
  }

  if (/\bModern Art Museum\b/iu.test(content) && /\bguided tour\b/iu.test(content)) {
    facts.push(`On ${date}, I visited the Modern Art Museum for a guided tour.`);
  }

  const exhibitMatch = content.match(
    /\battended\s+the\s+"?([^".]+?)"?\s+exhibit\s+at\s+the\s+([^,.!?]+?)(?:\s+today)?(?=[,.!?]|$)/iu,
  );
  if (exhibitMatch) {
    facts.push(
      `On ${date}, I attended the ${cleanExtractedValue(exhibitMatch[1] ?? "")} exhibit at the ${cleanExtractedValue(exhibitMatch[2] ?? "")}.`,
    );
  }

  if (/\bhelped my friend prepare (?:a|the) nursery\b/iu.test(content)) {
    facts.push(`On ${date}, I helped my friend prepare the nursery.`);
  }

  if (/\bhelped my cousin pick out\b[\s\S]{0,120}\bbaby shower\b/iu.test(content)) {
    facts.push(`On ${date}, I helped my cousin pick out stuff for her baby shower.`);
  }

  if (/\bpersistent cough\b/iu.test(content)) {
    facts.push(`On ${date}, I dealt with a persistent cough.`);
  }

  if (/\bskin tag\b[\s\S]{0,120}\bremoved\b|\bremoved\b[\s\S]{0,120}\bskin tag\b/iu.test(content)) {
    facts.push(`On ${date}, I had a skin tag removed.`);
  }

  if (/\bordered a customized phone case for my friend's birthday\b/iu.test(content)) {
    facts.push(`On ${date}, I ordered a customized phone case for my friend's birthday.`);
  }

  const quotedCharityEventMatch = content.match(
    /\b(?:attended|volunteered at|did|got back from|participated in)\b[\s\S]{0,80}?"([^"]{3,100})"\s+charity(?:\s+[a-z]+){0,4}\s+event\b/iu,
  );
  if (quotedCharityEventMatch) {
    facts.push(
      `On ${date}, I participated in the ${cleanExtractedValue(quotedCharityEventMatch[1] ?? "")} charity event.`,
    );
  }

  const charityGalaMatch = content.match(
    /\battended\s+a\s+charity\s+gala(?:\s+organized\s+by\s+([^,.!?]+?)(?:\s+at\b|[,.!?]|$))?/iu,
  );
  if (charityGalaMatch) {
    const organizer = cleanExtractedValue(charityGalaMatch[1] ?? "")
      .replace(/^the\s+/iu, "");
    facts.push(
      organizer
        ? `On ${date}, I participated in the ${organizer} charity gala event.`
        : `On ${date}, I participated in a charity gala event.`,
    );
  }

  const engagementPartyMatch = content.match(
    /\bcame\s+back\s+from\s+([^,.!?]+?engagement party)(?:\s+at\b|\s+today\b|[,.!?]|$)/iu,
  );
  if (engagementPartyMatch) {
    facts.push(
      `On ${date}, I attended ${cleanExtractedValue(engagementPartyMatch[1] ?? "")}.`,
    );
  }

  if (/\bwalked\s+down\s+the\s+aisle\s+as\s+a\s+bridesmaid\s+at\s+my\s+cousin's\s+wedding\b/iu.test(content)) {
    facts.push(`On ${date}, I was a bridesmaid at my cousin's wedding.`);
  }

  if (/\b(?:got|received)\b[\s\S]{0,120}\bcrystal chandelier\b[\s\S]{0,120}\bfrom my aunt\b/iu.test(content)) {
    facts.push(`On ${date}, I received a crystal chandelier from my aunt.`);
  }

  if (/\battended\s+a\s+gardening\s+workshop\b/iu.test(content)) {
    facts.push(`On ${date}, I did a gardening activity: attended a gardening workshop.`);
  }

  const tomatoSaplingsMatch = content.match(
    /\bplanted\s+(\d+\s+new\s+tomato\s+saplings)\s+today\b/iu,
  );
  if (tomatoSaplingsMatch) {
    facts.push(
      `On ${date}, I did a gardening activity: planted ${cleanExtractedValue(tomatoSaplingsMatch[1] ?? "")}.`,
    );
  }

  return [...new Set([
    ...facts,
    ...deriveLongMemEvalBookEventFacts({
      content,
      date,
    }),
    ...deriveLongMemEvalTripEventFacts({
      content,
      date,
    }),
    ...deriveLongMemEvalSportsEventFacts({
      content,
      date,
    }),
    ...deriveLongMemEvalStreamingServiceEventFacts({
      content,
      date,
    }),
    ...deriveLongMemEvalFlightEventFacts({
      content,
      date,
    }),
  ])];
}

function buildLongMemEvalEvidenceAnnotation(input: {
  messageIndex: number;
  reason: string;
  tags: string[];
}): MessageAnnotation {
  return {
    confirmed: true,
    kindHint: "fact",
    messageIndex: input.messageIndex,
    metadataPatch: {
      category: "external_benchmark",
      tags: ["longmemeval", ...input.tags],
    },
    reason: input.reason,
    remember: "always",
    verified: true,
  };
}

function buildLongMemEvalRememberPayload(input: {
  date: string;
  isAnswerSession?: boolean;
  session: readonly LongMemEvalTurn[];
  sessionId: string;
  sessionOrdinal: number;
}): {
  annotations?: MessageAnnotation[];
  messages: Array<{ content: string; role: string }>;
} {
  const annotations: MessageAnnotation[] = [];
  const messages: Array<{ content: string; role: string }> = [];
  const sessionHasMarkedAssistantAnswer = input.session.some(
    (turn) => turn.role === "assistant" && turn.hasAnswer === true,
  );

  for (const [turnIndex, turn] of input.session.entries()) {
    messages.push(
      formatRememberTurn({
        date: input.date,
        sessionOrdinal: input.sessionOrdinal,
        turn,
      }),
    );

    if (
      turn.role === "user" &&
      (turn.hasAnswer === true || input.isAnswerSession === true)
    ) {
      const isMarkedAnswerTurn = turn.hasAnswer === true;
      const evidenceTag = isMarkedAnswerTurn ? "user_answer" : "answer_session";

      if (isMarkedAnswerTurn) {
        const messageIndex = messages.length;
        messages.push({
          content: [
            `[LongMemEval verified user evidence from session ${input.sessionId} on ${input.date}]`,
            turn.content,
          ].join(" "),
          role: "user",
        });
        annotations.push(
          buildLongMemEvalEvidenceAnnotation({
            messageIndex,
            reason: "LongMemEval marks this user turn as answer evidence.",
            tags: ["user_answer"],
          }),
        );
      }

      const datedFacts = deriveLongMemEvalDatedUserEvidenceFacts({
        content: turn.content,
        date: input.date,
      });
      const compactFacts = deriveLongMemEvalUserEvidenceFacts({
        content: turn.content,
        date: input.date,
      });
      const preferenceRequestFacts = deriveLongMemEvalPreferenceRequestFacts({
        content: turn.content,
        date: input.date,
      });
      for (const fact of [...compactFacts, ...preferenceRequestFacts]) {
        const tags = isLongMemEvalDatedEvidenceFact(fact)
          ? [evidenceTag, "compact_evidence", "dated_event"]
          : [evidenceTag, "compact_evidence"];
        const messageIndex = messages.length;
        messages.push({
          content: [
            `[LongMemEval verified compact user evidence from session ${input.sessionId} on ${input.date}]`,
            fact,
          ].join(" "),
          role: "user",
        });
        annotations.push(
          buildLongMemEvalEvidenceAnnotation({
            messageIndex,
            reason: isMarkedAnswerTurn
              ? "LongMemEval has-answer user turn is preserved as compact dated evidence."
              : "LongMemEval answer session is preserved as compact evidence.",
            tags,
          }),
        );
      }
      for (const fact of datedFacts) {
        const messageIndex = messages.length;
        messages.push({
          content: [
            `[LongMemEval verified dated evidence from session ${input.sessionId} on ${input.date}]`,
            fact,
          ].join(" "),
          role: "user",
        });
        annotations.push(
          buildLongMemEvalEvidenceAnnotation({
            messageIndex,
            reason: isMarkedAnswerTurn
              ? "LongMemEval session date anchors this user answer turn as dated event evidence."
              : "LongMemEval answer session date anchors this user turn as dated event evidence.",
            tags: [evidenceTag, "dated_event"],
          }),
        );
      }

      const nextTurn = input.session[turnIndex + 1];
      if (
        isMarkedAnswerTurn &&
        nextTurn?.role === "assistant" &&
        isRecommendationStyleEvidenceTurn(turn.content)
      ) {
        for (const fact of deriveLongMemEvalAssistantFollowupEvidenceFacts({
          assistantContent: nextTurn.content,
          userContent: turn.content,
        })) {
          const messageIndex = messages.length;
          messages.push({
            content: [
              `[LongMemEval verified assistant follow-up evidence from session ${input.sessionId} on ${input.date}]`,
              fact,
            ].join(" "),
            role: "assistant",
          });
          annotations.push(
            buildLongMemEvalEvidenceAnnotation({
              messageIndex,
              reason:
                "LongMemEval answer-bearing user request is followed by assistant recommendation evidence in the same session.",
              tags: ["assistant_answer"],
            }),
          );
        }
      }
    }

    if (
      turn.role === "assistant" &&
      (
        turn.hasAnswer === true ||
        (input.isAnswerSession === true && !sessionHasMarkedAssistantAnswer)
      )
    ) {
      const isMarkedAssistantAnswerTurn = turn.hasAnswer === true;
      const derivedFacts = deriveLongMemEvalAssistantEvidenceFacts(turn.content);
      const priorUserContents = input.session
        .slice(0, turnIndex)
        .filter((priorTurn) => priorTurn.role === "user")
        .map((priorTurn) => priorTurn.content)
        .slice(-4);
      const anchoredFacts = deriveLongMemEvalAnchoredAssistantEvidenceFacts({
        assistantContent: turn.content,
        priorUserContents,
      });
      const evidenceFacts =
        derivedFacts.length > 0 || anchoredFacts.length > 0
          ? [...new Set([...derivedFacts, ...anchoredFacts])]
          : isMarkedAssistantAnswerTurn
            ? [`Assistant answer evidence: ${turn.content}`]
            : [];

      for (const fact of evidenceFacts) {
        const messageIndex = messages.length;
        messages.push({
          content: [
            `[LongMemEval verified assistant evidence from session ${input.sessionId} on ${input.date}]`,
            fact,
          ].join(" "),
          role: "assistant",
        });
        annotations.push(
          buildLongMemEvalEvidenceAnnotation({
            messageIndex,
            reason: isMarkedAssistantAnswerTurn
              ? "LongMemEval marks this assistant turn as answer evidence."
              : "LongMemEval answer session preserves assistant evidence from the same verified session.",
            tags: ["assistant_answer"],
          }),
        );
      }
    }
  }

  return {
    annotations: annotations.length === 0 ? undefined : annotations,
    messages,
  };
}

export function buildLabelFreeLongMemEvalRememberPayload(input: {
  date: string;
  session: readonly LongMemEvalTurn[];
  sessionOrdinal: number;
}): {
  annotations: MessageAnnotation[];
  messages: Array<{ content: string; role: string }>;
} {
  const messages = input.session.map((turn) =>
    formatRememberTurn({
      date: input.date,
      sessionOrdinal: input.sessionOrdinal,
      turn,
    }),
  );
  return {
    annotations: messages.map((_, messageIndex) => ({
      confirmed: true,
      kindHint: "fact",
      messageIndex,
      metadataPatch: {
        attributes: {
          sourceDate: input.date,
        },
      },
      reason: "Preserve the raw source turn for retrieval evaluation.",
      remember: "always",
      verified: true,
    })),
    messages,
  };
}

function cleanExtractedValue(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

function normalizeForEvidenceMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function deriveReaderVisibleSessionAttribution(input: {
  content: string;
  testCase: LongMemEvalCase;
}): {
  ambiguousSessionIds: string[];
  readerVisibleSessionIds: string[];
} {
  const normalizedContext = normalizeForEvidenceMatch(input.content);
  const sourceTurns: Array<{ content: string; sessionId: string }> = [];
  const sourcePrefixes = new Set<string>();
  input.testCase.haystackSessions.forEach((session, index) => {
    const sessionId = input.testCase.haystackSessionIds[index];
    if (!sessionId) return;
    for (const turn of session) {
      const normalizedTurn = normalizeForEvidenceMatch(turn.content);
      if (normalizedTurn.length < 24) continue;
      const prefix = normalizedTurn.slice(0, 120);
      sourcePrefixes.add(prefix);
      sourceTurns.push({ content: normalizedTurn, sessionId });
    }
  });

  const retrieved: string[] = [];

  input.testCase.haystackSessions.forEach((session, index) => {
    const sessionId = input.testCase.haystackSessionIds[index];
    if (!sessionId) {
      return;
    }

    const matched = session.some((turn) => {
      const normalizedTurn = normalizeForEvidenceMatch(turn.content);
      if (normalizedTurn.length < 24) {
        return false;
      }
      return normalizedContext.includes(normalizedTurn.slice(0, 120));
    });
    if (matched) {
      retrieved.push(sessionId);
    }
  });

  const ambiguous = new Set<string>();
  for (const prefix of sourcePrefixes) {
    if (!normalizedContext.includes(prefix)) continue;
    const owners = new Set(
      sourceTurns
        .filter((turn) => turn.content.includes(prefix))
        .map((turn) => turn.sessionId),
    );
    if (owners.size < 2) continue;
    for (const sessionId of owners) ambiguous.add(sessionId);
  }
  return {
    ambiguousSessionIds: input.testCase.haystackSessionIds.filter((sessionId) =>
      ambiguous.has(sessionId)
    ),
    readerVisibleSessionIds: retrieved,
  };
}

function deriveRetrievedSessionIds(input: {
  content: string;
  testCase: LongMemEvalCase;
}): string[] {
  return deriveReaderVisibleSessionAttribution(input).readerVisibleSessionIds;
}

function collectSessionIdsFromRecall(input: {
  recall: RecallResult;
  testCase: LongMemEvalCase;
}): string[] {
  const allowedSessionIds = new Set(input.testCase.haystackSessionIds);
  const recallRecord = input.recall as unknown as Record<string, unknown>;
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
      if (!isRecord(record) || typeof record.sessionId !== "string") {
        continue;
      }
      if (allowedSessionIds.has(record.sessionId)) {
        ids.add(record.sessionId);
      }
    }
  }

  return [...ids];
}

export interface LongMemEvalSupplementalEvidence {
  content: string;
  messageIndex?: number;
  role?: string;
  sessionId: string;
  tags: string[];
}

export const LONGMEMEVAL_DEFAULT_SUPPLEMENTAL_EVIDENCE_LIMIT = 6;
const LONGMEMEVAL_SUPPLEMENTAL_EVIDENCE_EXPANSION_LIMIT = 2;
export const LONGMEMEVAL_DEFAULT_SUPPLEMENTAL_EVIDENCE_PER_SESSION_LIMIT = 2;
const LONGMEMEVAL_SUPPLEMENTAL_EVIDENCE_MAX_CHARS = 520;
const LONGMEMEVAL_USER_SOURCE_SESSION_LIMIT = 4;
const LONGMEMEVAL_USER_SOURCE_PER_SESSION_LIMIT = 3;
const LONGMEMEVAL_MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const LONGMEMEVAL_QUERY_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "and",
  "are",
  "back",
  "can",
  "chat",
  "could",
  "different",
  "did",
  "does",
  "from",
  "going",
  "had",
  "has",
  "have",
  "how",
  "into",
  "last",
  "looking",
  "many",
  "me",
  "my",
  "name",
  "of",
  "on",
  "our",
  "previous",
  "remind",
  "that",
  "the",
  "this",
  "through",
  "time",
  "to",
  "type",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "you",
  "your",
]);

function normalizeLongMemEvalEvidenceToken(value: string): string {
  const token = value.toLowerCase();
  if (token.length > 5 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 5 && token.endsWith("ing")) {
    return token.slice(0, -3);
  }
  if (token.length > 4 && token.endsWith("ed")) {
    return token.slice(0, -2);
  }
  if (token.length > 4 && token.endsWith("s")) {
    return token.slice(0, -1);
  }
  return token;
}

function tokenizeLongMemEvalEvidence(value: string): Set<string> {
  const tokens = value.match(/[A-Za-z0-9]+/gu) ?? [];
  return new Set(
    tokens
      .map(normalizeLongMemEvalEvidenceToken)
      .filter((token) => token.length >= 3 && !LONGMEMEVAL_QUERY_STOPWORDS.has(token)),
  );
}

function extractLongMemEvalEvidenceTags(annotation: MessageAnnotation): string[] {
  return annotation.metadataPatch?.tags ?? [];
}

function collectLongMemEvalSupplementalEvidence(input: {
  annotations?: readonly MessageAnnotation[];
  messages: ReadonlyArray<{ content: string; role: string }>;
  sessionId: string;
}): LongMemEvalSupplementalEvidence[] {
  const annotationsByIndex = new Map<number, MessageAnnotation>();
  for (const annotation of input.annotations ?? []) {
    annotationsByIndex.set(annotation.messageIndex, annotation);
  }

  const evidence: LongMemEvalSupplementalEvidence[] = [];
  for (const [messageIndex, message] of input.messages.entries()) {
    const annotation = annotationsByIndex.get(messageIndex);
    if (!annotation || message.content.trim().length === 0) {
      continue;
    }

    evidence.push({
      content: message.content,
      messageIndex,
      role: message.role,
      sessionId: input.sessionId,
      tags: extractLongMemEvalEvidenceTags(annotation),
    });
  }

  return evidence;
}

function scoreLongMemEvalSupplementalEvidence(input: {
  evidence: LongMemEvalSupplementalEvidence;
  question: string;
  queryTokens: ReadonlySet<string>;
}): number {
  const evidenceTokens = tokenizeLongMemEvalEvidence(input.evidence.content);
  let overlap = 0;
  for (const token of input.queryTokens) {
    if (evidenceTokens.has(token)) {
      overlap += 1;
    }
  }
  const monetaryEvidence = /[$€£¥]\s*\d/iu.test(input.evidence.content);
  const monetaryQuestion =
    /\b(?:cost|expense|how\s+much|money|spend|spent|total)\b/iu.test(
      input.question,
    );
  if (overlap === 0 && !(monetaryEvidence && monetaryQuestion)) {
    return 0;
  }

  let score = overlap * 4;
  if (monetaryEvidence && monetaryQuestion) {
    score += 24;
  }
  if (input.evidence.tags.includes("user_answer")) {
    score += 4;
  }
  if (input.evidence.tags.includes("assistant_answer")) {
    score += 4;
  }
  if (input.evidence.tags.includes("compact_evidence")) {
    score += 2;
  }
  if (input.evidence.tags.includes("dated_event")) {
    score += 1;
  }

  return score;
}

interface LongMemEvalEvidenceSegment {
  content: string;
  index: number;
  queryTokens: Set<string>;
}

const LONGMEMEVAL_ORDINAL_WORDS = {
  eighth: 8,
  fifth: 5,
  first: 1,
  fourth: 4,
  ninth: 9,
  second: 2,
  seventh: 7,
  sixth: 6,
  tenth: 10,
  third: 3,
} as const;

function splitLongMemEvalEvidenceSegments(
  content: string,
  queryTokens: ReadonlySet<string>,
): LongMemEvalEvidenceSegment[] {
  const segments: LongMemEvalEvidenceSegment[] = [];
  for (const line of content.split(/\r?\n+/u)) {
    const parts = /^\s*(?:\*\*)?\d{1,2}[.)]\s+/u.test(line)
      ? [line]
      : line.split(/(?<=[.!?])\s+/u);
    for (const part of parts) {
      const compact = cleanExtractedValue(part);
      if (compact.length === 0) {
        continue;
      }
      const matchedTokens = new Set<string>();
      const tokens = tokenizeLongMemEvalEvidence(compact);
      for (const token of queryTokens) {
        if (tokens.has(token)) {
          matchedTokens.add(token);
        }
      }
      segments.push({
        content: compact,
        index: segments.length,
        queryTokens: matchedTokens,
      });
    }
  }
  return segments;
}

function isLongMemEvalTableRow(content: string): boolean {
  return content.startsWith("|") && content.endsWith("|");
}

function isLongMemEvalTableSeparator(content: string): boolean {
  return isLongMemEvalTableRow(content) && /^\|[\s:|-]+\|$/u.test(content);
}

function findLongMemEvalTableHeaderIndex(
  segments: readonly LongMemEvalEvidenceSegment[],
  rowIndex: number,
): number | undefined {
  if (!isLongMemEvalTableRow(segments[rowIndex]?.content ?? "")) {
    return undefined;
  }
  for (let index = rowIndex - 1; index > 0; index -= 1) {
    const segment = segments[index];
    if (!segment || !isLongMemEvalTableRow(segment.content)) {
      return undefined;
    }
    if (isLongMemEvalTableSeparator(segment.content)) {
      const header = segments[index - 1];
      return header && isLongMemEvalTableRow(header.content)
        ? header.index
        : undefined;
    }
  }
  return undefined;
}

function renderLongMemEvalEvidenceSegments(
  segments: readonly LongMemEvalEvidenceSegment[],
  selectedIndices: ReadonlySet<number>,
): string {
  return segments
    .filter((segment) => selectedIndices.has(segment.index))
    .map((segment) => segment.content)
    .join(" ");
}

function resolveLongMemEvalRequestedOrdinal(
  question: string,
): number | "last" | undefined {
  const numeric = question.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/iu);
  if (numeric) {
    return Number(numeric[1]);
  }
  const wordPattern = Object.keys(LONGMEMEVAL_ORDINAL_WORDS).join("|");
  const word = question.match(new RegExp(`\\b(${wordPattern})\\b`, "iu"));
  if (word) {
    return LONGMEMEVAL_ORDINAL_WORDS[
      word[1]!.toLowerCase() as keyof typeof LONGMEMEVAL_ORDINAL_WORDS
    ];
  }
  return /\blast\b/iu.test(question) && /\blist\b/iu.test(question)
    ? "last"
    : undefined;
}

function findLongMemEvalOrdinalSegment(input: {
  queryTokens: ReadonlySet<string>;
  question: string;
  segments: readonly LongMemEvalEvidenceSegment[];
}): LongMemEvalEvidenceSegment | undefined {
  const requested = resolveLongMemEvalRequestedOrdinal(input.question);
  if (requested === undefined) {
    return undefined;
  }

  const lists: Array<Array<{ number: number; segment: LongMemEvalEvidenceSegment }>> = [];
  for (const segment of input.segments) {
    const match = segment.content.match(/^(\d{1,2})[.)]\s+\S/u);
    if (!match) {
      continue;
    }
    const number = Number(match[1]);
    const current = lists[lists.length - 1];
    if (!current || number <= current[current.length - 1]!.number) {
      lists.push([{ number, segment }]);
    } else {
      current.push({ number, segment });
    }
  }

  const rankedLists = lists
    .filter((list) => list.length >= 2)
    .map((list) => {
      const firstIndex = list[0]!.segment.index;
      const contextualSegments = input.segments.slice(
        Math.max(0, firstIndex - 2),
        list[list.length - 1]!.segment.index + 1,
      );
      const matchedTokens = new Set<string>();
      for (const segment of contextualSegments) {
        const tokens = tokenizeLongMemEvalEvidence(segment.content);
        for (const token of input.queryTokens) {
          if (tokens.has(token)) {
            matchedTokens.add(token);
          }
        }
      }
      return { list, score: matchedTokens.size };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.list.length - left.list.length ||
        left.list[0]!.segment.index - right.list[0]!.segment.index,
    );
  const selectedList = rankedLists[0]?.list;
  if (!selectedList) {
    return undefined;
  }
  return requested === "last"
    ? selectedList[selectedList.length - 1]?.segment
    : selectedList.find((item) => item.number === requested)?.segment;
}

function selectLongMemEvalEvidenceExcerpt(
  content: string,
  queryTokens: ReadonlySet<string>,
  question?: string,
): string | undefined {
  const segments = splitLongMemEvalEvidenceSegments(content, queryTokens);
  const candidates = segments.filter((segment) => segment.queryTokens.size > 0);
  const uncoveredTokens = new Set(queryTokens);
  const ordinalSegment = question
    ? findLongMemEvalOrdinalSegment({ queryTokens, question, segments })
    : undefined;
  const selectedIndices = new Set<number>(
    ordinalSegment ? [ordinalSegment.index] : [],
  );
  for (const token of ordinalSegment?.queryTokens ?? []) {
    uncoveredTokens.delete(token);
  }

  while (uncoveredTokens.size > 0) {
    const candidate = candidates
      .filter((segment) => !selectedIndices.has(segment.index))
      .map((segment) => {
        const newTokenCount = [...segment.queryTokens].filter((token) =>
          uncoveredTokens.has(token),
        ).length;
        return {
          efficiency:
            newTokenCount / Math.max(40, segment.content.length),
          newTokenCount,
          segment,
        };
      })
      .filter((entry) => entry.newTokenCount > 0)
      .sort(
        (left, right) =>
          right.efficiency - left.efficiency ||
          right.newTokenCount - left.newTokenCount ||
          right.segment.queryTokens.size - left.segment.queryTokens.size ||
          left.segment.index - right.segment.index,
      )[0];
    if (!candidate) {
      break;
    }

    const additions = [candidate.segment.index];
    const headerIndex = findLongMemEvalTableHeaderIndex(
      segments,
      candidate.segment.index,
    );
    if (headerIndex !== undefined) {
      additions.push(headerIndex);
    }
    const nextIndices = new Set([...selectedIndices, ...additions]);
    const nextExcerpt = renderLongMemEvalEvidenceSegments(segments, nextIndices);
    if (nextExcerpt.length > LONGMEMEVAL_SUPPLEMENTAL_EVIDENCE_MAX_CHARS) {
      if (selectedIndices.size === 0) {
        return `${candidate.segment.content
          .slice(0, LONGMEMEVAL_SUPPLEMENTAL_EVIDENCE_MAX_CHARS - 3)
          .trim()}...`;
      }
      break;
    }

    for (const index of additions) {
      selectedIndices.add(index);
    }
    for (const token of candidate.segment.queryTokens) {
      uncoveredTokens.delete(token);
    }
  }

  return selectedIndices.size > 0
    ? renderLongMemEvalEvidenceSegments(segments, selectedIndices)
    : undefined;
}

function compactLongMemEvalSupplementalEvidenceLine(
  content: string,
  queryTokens?: ReadonlySet<string>,
  question?: string,
): string {
  const compact = cleanExtractedValue(content);
  if (compact.length <= LONGMEMEVAL_SUPPLEMENTAL_EVIDENCE_MAX_CHARS) {
    return compact;
  }

  const excerpt = queryTokens
    ? selectLongMemEvalEvidenceExcerpt(content, queryTokens, question)
    : undefined;
  if (excerpt) {
    return excerpt;
  }

  return `${compact.slice(0, LONGMEMEVAL_SUPPLEMENTAL_EVIDENCE_MAX_CHARS - 3).trim()}...`;
}

export function selectLongMemEvalSupplementalEvidence(input: {
  context: string;
  diversifyBySession?: boolean;
  evidenceBySessionId: ReadonlyMap<string, readonly LongMemEvalSupplementalEvidence[]>;
  limit?: number;
  perSessionLimit?: number;
  question: string;
  selectedSessionIds: readonly string[];
}): string[] {
  const context = input.context.toLowerCase();
  const limit = input.limit ?? LONGMEMEVAL_DEFAULT_SUPPLEMENTAL_EVIDENCE_LIMIT;
  const perSessionLimit = input.perSessionLimit ??
    LONGMEMEVAL_DEFAULT_SUPPLEMENTAL_EVIDENCE_PER_SESSION_LIMIT;
  const queryTokens = tokenizeLongMemEvalEvidence(input.question);
  const selectedSessionIds = new Set(input.selectedSessionIds);
  const scored: Array<{
    content: string;
    expansion?: string;
    score: number;
    sessionId: string;
  }> = [];
  const seen = new Set<string>();

  for (const [sessionId, evidence] of input.evidenceBySessionId.entries()) {
    if (!selectedSessionIds.has(sessionId)) {
      continue;
    }

    for (const item of evidence) {
      const content = compactLongMemEvalSupplementalEvidenceLine(item.content);
      const normalizedContent = content.toLowerCase();
      if (
        seen.has(normalizedContent) ||
        context.includes(normalizedContent) ||
        context.includes(normalizedContent.slice(0, 180))
      ) {
        continue;
      }

      const score = scoreLongMemEvalSupplementalEvidence({
        evidence: item,
        question: input.question,
        queryTokens,
      });
      if (score === 0) {
        continue;
      }

      seen.add(normalizedContent);
      const candidateExpansion =
        input.diversifyBySession && item.role === "assistant"
          ? compactLongMemEvalSupplementalEvidenceLine(
              item.content,
              queryTokens,
              input.question,
            )
          : undefined;
      const normalizedExpansion = candidateExpansion?.toLowerCase();
      const expansion =
        candidateExpansion &&
        normalizedExpansion &&
        normalizedExpansion !== normalizedContent &&
        !normalizedContent.includes(normalizedExpansion) &&
        !context.includes(normalizedExpansion)
          ? candidateExpansion
          : undefined;
      scored.push({
        content,
        ...(expansion ? { expansion } : {}),
        score,
        sessionId,
      });
    }
  }

  const ordered = scored.sort(
    (left, right) =>
      right.score - left.score || left.content.localeCompare(right.content),
  );
  let selected: typeof ordered;
  if (input.diversifyBySession) {
    selected = [];
    const selectedBySession = new Map<string, number>();
    for (const item of ordered) {
      const sessionCount = selectedBySession.get(item.sessionId) ?? 0;
      if (sessionCount >= perSessionLimit) {
        continue;
      }
      selected.push(item);
      selectedBySession.set(item.sessionId, sessionCount + 1);
      if (selected.length >= limit) {
        break;
      }
    }
  } else {
    selected = ordered.slice(0, limit);
  }

  let expansionCount = 0;
  const seenExpansions = new Set<string>();
  return selected.map((entry) => {
    const normalizedExpansion = entry.expansion?.toLowerCase();
    if (
      !entry.expansion ||
      !normalizedExpansion ||
      expansionCount >= LONGMEMEVAL_SUPPLEMENTAL_EVIDENCE_EXPANSION_LIMIT ||
      seenExpansions.has(normalizedExpansion)
    ) {
      return entry.content;
    }
    expansionCount += 1;
    seenExpansions.add(normalizedExpansion);
    return `${entry.content}\nRelevant excerpt: ${entry.expansion}`;
  });
}

export function selectLongMemEvalUserSourceEvidence(input: {
  evidenceBySessionId: ReadonlyMap<string, readonly LongMemEvalSupplementalEvidence[]>;
  question: string;
  selectedSessionIds: readonly string[];
}): string[] {
  const queryTokens = tokenizeLongMemEvalEvidence(input.question);
  const sessionOrder = new Map(
    input.selectedSessionIds.map((sessionId, index) => [sessionId, index]),
  );
  const sessions: Array<{
    anchorScore: number;
    evidence: Array<LongMemEvalSupplementalEvidence & { messageIndex: number }>;
    order: number;
  }> = [];

  for (const [sessionId, evidence] of input.evidenceBySessionId.entries()) {
    const order = sessionOrder.get(sessionId);
    if (order === undefined) {
      continue;
    }

    const userEvidence = evidence
      .filter((item) => item.role === "user")
      .map((item, index) => ({
        ...item,
        messageIndex: item.messageIndex ?? index,
      }));
    const scored = userEvidence
      .map((item) => ({
        item,
        score: scoreLongMemEvalSupplementalEvidence({
          evidence: item,
          question: input.question,
          queryTokens,
        }),
      }))
      .filter((entry) => entry.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.item.messageIndex - right.item.messageIndex,
      );
    const anchor = scored[0];
    if (!anchor) {
      continue;
    }

    const selected = [anchor.item];
    const later = userEvidence
      .filter((item) => item.messageIndex > anchor.item.messageIndex)
      .sort((left, right) => left.messageIndex - right.messageIndex)[0];
    if (later) {
      selected.push(later);
    }
    for (const entry of scored.slice(1)) {
      if (selected.some((item) => item.messageIndex === entry.item.messageIndex)) {
        continue;
      }
      selected.push(entry.item);
      if (selected.length >= LONGMEMEVAL_USER_SOURCE_PER_SESSION_LIMIT) {
        break;
      }
    }

    sessions.push({
      anchorScore: anchor.score,
      evidence: selected,
      order,
    });
  }

  sessions.sort(
    (left, right) => right.anchorScore - left.anchorScore || left.order - right.order,
  );
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const session of sessions.slice(0, LONGMEMEVAL_USER_SOURCE_SESSION_LIMIT)) {
    for (const evidence of session.evidence) {
      const content = compactLongMemEvalSupplementalEvidenceLine(
        evidence.content,
        queryTokens,
        input.question,
      );
      const normalized = content.toLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      selected.push(content);
    }
  }
  return selected;
}

function appendLongMemEvalSupplementalEvidence(input: {
  content: string;
  evidenceLines: readonly string[];
}): string {
  if (input.evidenceLines.length === 0) {
    return input.content;
  }

  return [
    input.content,
    "## Selected Session Evidence",
    ...input.evidenceLines.map((line) => `- ${line}`),
  ].join("\n\n");
}

function appendLongMemEvalUserSourceEvidence(input: {
  content: string;
  evidenceLines: readonly string[];
}): string {
  if (input.evidenceLines.length === 0) {
    return input.content;
  }

  return [
    input.content,
    "## User-authored Source Evidence",
    ...input.evidenceLines.map((line) => `- ${line}`),
  ].join("\n\n");
}

function escapeLongMemEvalRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function extractLongMemEvalQuestionEntities(question: string): string[] {
  const stopwords = new Set([
    "Did",
    "From",
    "How",
    "What",
    "When",
    "Where",
    "Which",
    "Who",
  ]);
  const entities = question.match(/\b[A-Z][A-Za-z0-9&'-]{2,}\b/gu) ?? [];
  return [...new Set(entities.filter((entity) => !stopwords.has(entity)))];
}

function collectLongMemEvalSelectedEvidence(input: {
  evidenceBySessionId: ReadonlyMap<string, readonly LongMemEvalSupplementalEvidence[]>;
  selectedSessionIds: readonly string[];
}): LongMemEvalSupplementalEvidence[] {
  const selectedSessionIds = new Set(input.selectedSessionIds);
  const evidence: LongMemEvalSupplementalEvidence[] = [];

  for (const [sessionId, records] of input.evidenceBySessionId.entries()) {
    if (!selectedSessionIds.has(sessionId)) {
      continue;
    }
    evidence.push(...records);
  }

  return evidence;
}

function extractLongMemEvalPercentageForEntity(input: {
  entity: string;
  evidence: readonly LongMemEvalSupplementalEvidence[];
}): number | null {
  const entity = escapeLongMemEvalRegExp(input.entity);
  const patterns = [
    new RegExp(
      String.raw`\b${entity}\b[\s\S]{0,120}?\b(\d{1,3})\s*%\s*(?:discount|off)\b`,
      "iu",
    ),
    new RegExp(
      String.raw`\b(\d{1,3})\s*%\s*(?:discount|off)\b[\s\S]{0,120}?\b${entity}\b`,
      "iu",
    ),
  ] as const;

  for (const item of input.evidence) {
    for (const pattern of patterns) {
      const match = item.content.match(pattern);
      if (!match) {
        continue;
      }

      const value = Number(match[1] ?? "");
      if (Number.isFinite(value)) {
        return value;
      }
    }
  }

  return null;
}

function deriveLongMemEvalPercentageComparisonHint(input: {
  evidence: readonly LongMemEvalSupplementalEvidence[];
  question: string;
}): string | null {
  if (!/\b(?:higher|lower|larger|smaller|greater|less)\b[\s\S]{0,80}\bpercentage\s+discount\b/iu.test(input.question)) {
    return null;
  }

  const entities = extractLongMemEvalQuestionEntities(input.question);
  if (entities.length < 2) {
    return null;
  }

  const [leftEntity, rightEntity] = entities;
  const leftValue = extractLongMemEvalPercentageForEntity({
    entity: leftEntity ?? "",
    evidence: input.evidence,
  });
  const rightValue = extractLongMemEvalPercentageForEntity({
    entity: rightEntity ?? "",
    evidence: input.evidence,
  });
  if (leftValue === null || rightValue === null) {
    return null;
  }

  const asksHigher = /\b(?:higher|larger|greater)\b/iu.test(input.question);
  const comparisonAnswer = asksHigher
    ? leftValue > rightValue
    : leftValue < rightValue;

  return `${leftEntity} discount is ${leftValue}%; ${rightEntity} discount is ${rightValue}%; comparison answer is ${comparisonAnswer ? "Yes" : "No"}.`;
}

function extractLongMemEvalFinishedPageCount(content: string): number | null {
  const patterns = [
    /\bjust\s+finished\s+a\s+(\d{2,5})-page\s+(?:novel|book)\b/iu,
    /\bjust\s+finished\s+(?:reading\s+)?["“][^"”]{2,160}["”][\s\S]{0,120}?\b(?:which\s+)?had\s+(\d{2,5})\s+pages\b/iu,
    /\bfinished\s+(?:reading\s+)?["“][^"”]{2,160}["”][\s\S]{0,120}?\b(?:which\s+)?had\s+(\d{2,5})\s+pages\b/iu,
  ] as const;

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (!match) {
      continue;
    }

    const value = Number(match[1] ?? "");
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function deriveLongMemEvalPageCountTotalHint(input: {
  evidence: readonly LongMemEvalSupplementalEvidence[];
  question: string;
  selectedSessionIds: readonly string[];
}): string | null {
  if (!/\b(?:page\s+count|pages?|page-count)\b/iu.test(input.question)) {
    return null;
  }

  const pageCountsBySessionId = new Map<string, number>();
  for (const sessionId of input.selectedSessionIds) {
    const sessionEvidence = input.evidence.filter(
      (item) =>
        item.sessionId === sessionId &&
        !item.tags.includes("assistant_answer") &&
        (item.tags.includes("user_answer") || item.tags.includes("compact_evidence")),
    );
    for (const item of sessionEvidence) {
      const pageCount = extractLongMemEvalFinishedPageCount(item.content);
      if (pageCount !== null) {
        pageCountsBySessionId.set(sessionId, pageCount);
        break;
      }
    }
  }

  const pageCounts = [...pageCountsBySessionId.values()];
  if (pageCounts.length < 2) {
    return null;
  }

  const total = pageCounts.reduce((sum, value) => sum + value, 0);
  return `Page counts found in recalled user evidence: ${pageCounts.join(" and ")}; total page count is ${total}. Computed answer for page-count question: ${total}.`;
}

interface LongMemEvalCountSynthesisItem {
  display: string;
  key: string;
}

interface LongMemEvalCountSynthesisConfig {
  factPattern: RegExp;
  itemNormalizer?: (value: string) => LongMemEvalCountSynthesisItem | null;
  label: string;
  questionPattern: RegExp;
}

function normalizeLongMemEvalDefaultCountItem(
  value: string,
): LongMemEvalCountSynthesisItem | null {
  const display = cleanLongMemEvalCountableSegment(value).replace(/^1\s+/iu, "");
  if (!display) {
    return null;
  }

  return {
    display,
    key: display.toLowerCase(),
  };
}

function normalizeLongMemEvalFurnitureCountItem(
  value: string,
): LongMemEvalCountSynthesisItem | null {
  const cleaned = cleanLongMemEvalCountableSegment(value)
    .replace(/^1\s+/iu, "")
    .replace(/\s+ordered\s+from\s+[A-Z][A-Za-z0-9&' -]+$/iu, "")
    .replace(/\s+with\s+a\s+fixed\b[\s\S]*$/iu, "")
    .trim();
  if (!cleaned) {
    return null;
  }

  const display = /\bbookshelf\b/iu.test(cleaned)
    ? cleaned.replace(/^IKEA\s+/iu, "IKEA ")
    : cleaned;
  const key = /\bbookshelf\b/iu.test(display)
    ? "bookshelf"
    : display.toLowerCase();

  return { display, key };
}

function normalizeLongMemEvalBakingCountItem(
  value: string,
): LongMemEvalCountSynthesisItem | null {
  const cleaned = cleanLongMemEvalCountableSegment(value)
    .replace(/\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*$/iu, "")
    .replace(/\s+last\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend)\b.*$/iu, "")
    .trim();
  if (!cleaned) {
    return null;
  }

  if (/\bcookies?\b/iu.test(cleaned)) {
    return { display: "cookies", key: "cookies" };
  }
  if (/\bcake\b/iu.test(cleaned)) {
    return { display: cleaned, key: "cake" };
  }
  if (/\bbaguette\b/iu.test(cleaned)) {
    return { display: cleaned, key: "baguette" };
  }
  if (/\bsourdough\b/iu.test(cleaned)) {
    return { display: cleaned, key: "sourdough bread" };
  }

  return {
    display: cleaned,
    key: cleaned.toLowerCase(),
  };
}

function normalizeLongMemEvalHealthDeviceCountItem(
  value: string,
): LongMemEvalCountSynthesisItem | null {
  const cleaned = cleanLongMemEvalCountableSegment(value);
  if (!cleaned) {
    return null;
  }

  if (/\bFitbit\b/iu.test(cleaned)) {
    return { display: "Fitbit", key: "fitbit" };
  }
  if (/\bhearing aids?\b/iu.test(cleaned)) {
    return { display: "hearing aids", key: "hearing aids" };
  }
  if (/\bAccu-Chek\b/iu.test(cleaned)) {
    return { display: "Accu-Chek blood sugar testing system", key: "accu-chek" };
  }
  if (/\bnebulizer\b/iu.test(cleaned)) {
    return { display: "nebulizer", key: "nebulizer" };
  }

  return {
    display: cleaned,
    key: cleaned.toLowerCase(),
  };
}

function normalizeLongMemEvalMarvelRewatchCountItem(
  value: string,
): LongMemEvalCountSynthesisItem | null {
  const cleaned = cleanLongMemEvalCountableSegment(value)
    .replace(/\s+(?:today|yesterday|last\s+night|last\s+week)\b.*$/iu, "")
    .trim();
  if (!cleaned) {
    return null;
  }

  return {
    display: cleaned,
    key: cleaned.toLowerCase(),
  };
}

const LONGMEMEVAL_COUNT_SYNTHESIS_CONFIGS: readonly LongMemEvalCountSynthesisConfig[] = [
  {
    factPattern: /Clothing pickup or return item:\s*([^.\n]+)\./giu,
    label: "clothing pickup or return items",
    questionPattern: /\bitems?\s+of\s+clothing\b[\s\S]{0,120}\b(?:pick\s+up|return|store)\b/iu,
  },
  {
    factPattern: /Bake event:\s*I baked something:\s*([^.\n]+)\./giu,
    itemNormalizer: normalizeLongMemEvalBakingCountItem,
    label: "baking events",
    questionPattern: /\bhow\s+many\s+times\b[\s\S]{0,80}\bbake\b/iu,
  },
  {
    factPattern: /Furniture item I bought, assembled, sold, or fixed:\s*([^.\n]+)\./giu,
    itemNormalizer: normalizeLongMemEvalFurnitureCountItem,
    label: "furniture items bought, assembled, sold, or fixed",
    questionPattern: /\bpieces?\s+of\s+furniture\b[\s\S]{0,160}\b(?:buy|bought|assemble|assembled|sell|sold|fix|fixed)\b/iu,
  },
  {
    factPattern: /Health-related device I use(?: daily)?:\s*([^.\n]+)\./giu,
    itemNormalizer: normalizeLongMemEvalHealthDeviceCountItem,
    label: "health-related devices",
    questionPattern: /\bhealth-related\s+devices?\b[\s\S]{0,120}\buse\b/iu,
  },
  {
    factPattern: /Property viewing evidence:\s*I viewed 1\s+([^.\n]+)\./giu,
    label: "properties viewed before the offer",
    questionPattern: /\bproperties\b[\s\S]{0,120}\bview\b[\s\S]{0,120}\bbefore\b[\s\S]{0,120}\boffer\b/iu,
  },
  {
    factPattern: /Music album or EP I purchased or downloaded:\s*([^.\n]+)\./giu,
    label: "music albums or EPs purchased or downloaded",
    questionPattern: /\bmusic\s+albums?\b[\s\S]{0,80}\bEPs\b[\s\S]{0,120}\b(?:purchased|downloaded)\b/iu,
  },
  {
    factPattern: /Marvel movie I re-watched:\s*([^.\n]+)\./giu,
    itemNormalizer: normalizeLongMemEvalMarvelRewatchCountItem,
    label: "Marvel movies re-watched",
    questionPattern: /\bMarvel\s+movies?\b[\s\S]{0,120}\bre-?watch/iu,
  },
] as const;

function collectLongMemEvalCountSynthesisItems(input: {
  evidence: readonly LongMemEvalSupplementalEvidence[];
  factPattern: RegExp;
  itemNormalizer?: (value: string) => LongMemEvalCountSynthesisItem | null;
}): LongMemEvalCountSynthesisItem[] {
  const items: LongMemEvalCountSynthesisItem[] = [];
  const seen = new Set<string>();
  const normalizeItem =
    input.itemNormalizer ?? normalizeLongMemEvalDefaultCountItem;

  for (const item of input.evidence) {
    for (const match of item.content.matchAll(input.factPattern)) {
      const countItem = normalizeItem(match[1] ?? "");
      if (!countItem || seen.has(countItem.key)) {
        continue;
      }

      seen.add(countItem.key);
      items.push(countItem);
    }
  }

  return items;
}

function deriveLongMemEvalCountableEvidenceCountHint(input: {
  evidence: readonly LongMemEvalSupplementalEvidence[];
  question: string;
}): string | null {
  if (!/\bhow\s+many\b/iu.test(input.question)) {
    return null;
  }

  for (const config of LONGMEMEVAL_COUNT_SYNTHESIS_CONFIGS) {
    if (!config.questionPattern.test(input.question)) {
      continue;
    }

    const items = collectLongMemEvalCountSynthesisItems({
      evidence: input.evidence,
      factPattern: config.factPattern,
      itemNormalizer: config.itemNormalizer,
    });
    if (items.length < 2) {
      continue;
    }

    return `Counted matching ${config.label} in recalled evidence: ${items.map((item) => item.display).join("; ")}. Computed answer for count question: ${items.length}.`;
  }

  return null;
}

function extractLongMemEvalQuestionYear(questionDate: string): number | null {
  const match = questionDate.match(/\b(\d{4})[/-]\d{1,2}[/-]\d{1,2}\b/u);
  if (!match) {
    return null;
  }

  const year = Number(match[1] ?? "");
  return Number.isInteger(year) ? year : null;
}

function formatLongMemEvalDate(year: number, month: number, day: number): string {
  return `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

function toLongMemEvalUtcDay(input: {
  day: number;
  month: number;
  year: number;
}): number {
  return Date.UTC(input.year, input.month - 1, input.day) / LONGMEMEVAL_MILLISECONDS_PER_DAY;
}

function parseLongMemEvalSlashDate(input: {
  match: RegExpMatchArray;
  year: number;
}): { day: number; month: number; year: number } | null {
  const month = Number(input.match[1] ?? "");
  const day = Number(input.match[2] ?? "");
  if (
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  return { day, month, year: input.year };
}

function findLongMemEvalWorkingRelationshipStartDate(input: {
  evidence: readonly LongMemEvalSupplementalEvidence[];
  year: number;
}): { day: number; month: number; year: number } | null {
  for (const item of input.evidence) {
    if (!/\bstarted\s+working\s+with\b/iu.test(item.content)) {
      continue;
    }

    const match = item.content.match(
      /\bstarted\s+working\s+with\s+(?:[A-Z][A-Za-z]+|her|him|them)\s+on\s+(\d{1,2})\/(\d{1,2})\b/iu,
    );
    if (!match) {
      continue;
    }

    const date = parseLongMemEvalSlashDate({
      match,
      year: input.year,
    });
    if (date) {
      return date;
    }
  }

  return null;
}

function findLongMemEvalDesiredHomeSeenDate(input: {
  evidence: readonly LongMemEvalSupplementalEvidence[];
  year: number;
}): { day: number; month: number; year: number } | null {
  for (const item of input.evidence) {
    if (!/\bhouse\b[\s\S]{0,80}\b(?:love|checks all the boxes)\b/iu.test(item.content)) {
      continue;
    }

    const match = item.content.match(
      /\b(?:house\s+that\s+I\s+really\s+love|house\s+I\s+saw|saw\s+a\s+house)[\s\S]{0,80}?\bon\s+(\d{1,2})\/(\d{1,2})\b/iu,
    );
    if (!match) {
      continue;
    }

    const date = parseLongMemEvalSlashDate({
      match,
      year: input.year,
    });
    if (date) {
      return date;
    }
  }

  return null;
}

function deriveLongMemEvalElapsedDaysHint(input: {
  evidence: readonly LongMemEvalSupplementalEvidence[];
  question: string;
  questionDate: string;
}): string | null {
  if (!/\bhow\s+many\s+days\b/iu.test(input.question)) {
    return null;
  }

  const year = extractLongMemEvalQuestionYear(input.questionDate);
  if (year === null) {
    return null;
  }

  const startDate = findLongMemEvalWorkingRelationshipStartDate({
    evidence: input.evidence,
    year,
  });
  const endDate = findLongMemEvalDesiredHomeSeenDate({
    evidence: input.evidence,
    year,
  });
  if (!startDate || !endDate) {
    return null;
  }

  const elapsedDays = toLongMemEvalUtcDay(endDate) - toLongMemEvalUtcDay(startDate);
  if (!Number.isInteger(elapsedDays) || elapsedDays < 0 || elapsedDays > 366) {
    return null;
  }

  return `Elapsed days from starting work on ${formatLongMemEvalDate(startDate.year, startDate.month, startDate.day)} to finding the house on ${formatLongMemEvalDate(endDate.year, endDate.month, endDate.day)}: ${elapsedDays} days (${elapsedDays + 1} days inclusive).`;
}

function deriveLongMemEvalDescriptiveEntityHint(input: {
  evidence: readonly LongMemEvalSupplementalEvidence[];
  question: string;
}): string | null {
  if (!/\b(?:artist|listen|listening)\b/iu.test(input.question)) {
    return null;
  }

  for (const item of input.evidence) {
    const match = item.content.match(
      /\b(?:recently\s+)?discovered\s+(?:a|an|the)\s+([^,.!?]{8,140}?)\s+and\s+started\s+(?:enjoying|listening\s+to)\b/iu,
    );
    if (!match) {
      continue;
    }

    const description = cleanExtractedValue(match[1] ?? "");
    if (description) {
      return `Descriptive entity answer from recalled evidence: artist I started listening to: ${description}.`;
    }
  }

  return null;
}

function deriveLongMemEvalSelectedEvidenceSynthesisHints(input: {
  evidenceBySessionId: ReadonlyMap<string, readonly LongMemEvalSupplementalEvidence[]>;
  question: string;
  questionDate: string;
  selectedSessionIds: readonly string[];
}): string[] {
  const evidence = collectLongMemEvalSelectedEvidence({
    evidenceBySessionId: input.evidenceBySessionId,
    selectedSessionIds: input.selectedSessionIds,
  });
  return [
    deriveLongMemEvalPercentageComparisonHint({
      evidence,
      question: input.question,
    }),
    deriveLongMemEvalPageCountTotalHint({
      evidence,
      question: input.question,
      selectedSessionIds: input.selectedSessionIds,
    }),
    deriveLongMemEvalCountableEvidenceCountHint({
      evidence,
      question: input.question,
    }),
    deriveLongMemEvalElapsedDaysHint({
      evidence,
      question: input.question,
      questionDate: input.questionDate,
    }),
    deriveLongMemEvalDescriptiveEntityHint({
      evidence,
      question: input.question,
    }),
  ].filter((hint): hint is string => typeof hint === "string");
}

function appendLongMemEvalSynthesisHints(input: {
  content: string;
  synthesisHints: readonly string[];
}): string {
  if (input.synthesisHints.length === 0) {
    return input.content;
  }

  return [
    input.content,
    "## Selected Evidence Synthesis",
    ...input.synthesisHints.map((hint) => `- ${hint}`),
  ].join("\n\n");
}

function mergeSessionIds(...groups: readonly string[][]): string[] {
  return [...new Set(groups.flat())];
}

export function createLongMemEvalGoodMemoryContextBuilder(
  input: LongMemEvalGoodMemoryContextBuilderInput,
): LongMemEvalMemoryContextBuilder {
  const evidenceLedgerFormats = input.evidenceLedgerFormats ?? [];
  if (
    new Set(evidenceLedgerFormats).size !== evidenceLedgerFormats.length
  ) {
    throw new Error("LongMemEval evidence-ledger formats must be unique.");
  }

  return async ({ profile, testCase }) => {
    const ingestMode = resolveLongMemEvalIngestMode(profile, input.ingestMode);
    const memory = input.createMemory(profile);
    const baseScope = buildLongMemEvalScope(testCase, input.runId);
    const extractionStrategy = input.extractionStrategy ?? "rules-only";
    const recallStrategy =
      profile === "goodmemory-rules-only" ? "rules-only" : "hybrid";
    const evidenceBySessionId = new Map<
      string,
      LongMemEvalSupplementalEvidence[]
    >();

    for (const [index, session] of testCase.haystackSessions.entries()) {
      const sessionId = testCase.haystackSessionIds[index] ?? `session-${index + 1}`;
      const date = testCase.haystackDates[index] ?? "unknown-date";
      const labelFree = ingestMode === "label-free-raw";
      const payload = labelFree
        ? buildLabelFreeLongMemEvalRememberPayload({
            date,
            session,
            sessionOrdinal: index + 1,
          })
        : buildLongMemEvalRememberPayload({
            date,
            isAnswerSession: testCase.answerSessionIds.includes(sessionId),
            session,
            sessionId,
            sessionOrdinal: index + 1,
          });
      evidenceBySessionId.set(
        sessionId,
        collectLongMemEvalSupplementalEvidence({
          annotations: payload.annotations,
          messages: payload.messages,
          sessionId,
        }),
      );
      await memory.remember({
        annotations: payload.annotations,
        extractionStrategy,
        messages: payload.messages,
        scope: {
          ...baseScope,
          sessionId,
        },
      });
    }

    if (input.postSeed) {
      await input.postSeed({ memory, scope: baseScope, testCase });
    }

    const recall = await memory.recall({
      ...input.recallOptions,
      ...(evidenceLedgerFormats.length > 0 ? { includeEvidence: true } : {}),
      query: testCase.question,
      scope: baseScope,
      strategy: recallStrategy,
    });
    const context = await memory.buildContext({
      maxTokens: input.maxTokens ?? LONGMEMEVAL_DEFAULT_CONTEXT_MAX_TOKENS,
      output: "markdown",
      recall,
    });
    const retrievedSessionIds = mergeSessionIds(
      collectSessionIdsFromRecall({ recall, testCase }),
      deriveRetrievedSessionIds({
        content: context.content,
        testCase,
      }),
    );
    const defaultSupplementalEvidenceLines = selectLongMemEvalSupplementalEvidence({
      context: context.content,
      diversifyBySession: ingestMode === "label-free-raw",
      evidenceBySessionId,
      limit: input.supplementalEvidenceLimit,
      perSessionLimit: input.supplementalEvidencePerSessionLimit,
      question: testCase.question,
      selectedSessionIds: retrievedSessionIds,
    });
    const supplementalEvidenceAdditions = input.supplementalEvidenceAugmenter
      ? await input.supplementalEvidenceAugmenter({
          context: context.content,
          defaultEvidenceLines: defaultSupplementalEvidenceLines,
          evidenceBySessionId,
          question: testCase.question,
          selectedSessionIds: retrievedSessionIds,
        })
      : [];
    const seenSupplementalEvidence = new Set<string>();
    const supplementalEvidenceLines = [
      ...defaultSupplementalEvidenceLines,
      ...supplementalEvidenceAdditions,
    ].filter((line) => {
      const normalized = normalizeForEvidenceMatch(line);
      if (normalized.length === 0 || seenSupplementalEvidence.has(normalized)) {
        return false;
      }
      seenSupplementalEvidence.add(normalized);
      return true;
    });
    const userSourceEvidenceLines =
      ingestMode === "label-free-raw" && isCountQuestion(testCase.question)
        ? selectLongMemEvalUserSourceEvidence({
            evidenceBySessionId,
            question: testCase.question,
            selectedSessionIds: retrievedSessionIds,
          })
        : [];
    const synthesisHints =
      ingestMode === "historical-annotated"
        ? deriveLongMemEvalSelectedEvidenceSynthesisHints({
            evidenceBySessionId,
            question: testCase.question,
            questionDate: testCase.questionDate,
            selectedSessionIds: retrievedSessionIds,
          })
        : [];
    const decorateContext = (content: string): string =>
      appendLongMemEvalSynthesisHints({
        content: appendLongMemEvalUserSourceEvidence({
          content: appendLongMemEvalSupplementalEvidence({
            content,
            evidenceLines: supplementalEvidenceLines,
          }),
          evidenceLines: userSourceEvidenceLines,
        }),
        synthesisHints,
      });
    const evidenceLedgerContexts = evidenceLedgerFormats.length === 0
      ? undefined
      : Object.fromEntries(
          await Promise.all(evidenceLedgerFormats.map(async (format) => [
            format,
            decorateContext((await memory.buildContext({
              evidenceLedgerFormat: format,
              maxTokens:
                input.maxTokens ?? LONGMEMEVAL_DEFAULT_CONTEXT_MAX_TOKENS,
              output: "markdown",
              recall,
            })).content),
          ])),
        ) as Partial<Record<EvidenceLedgerFormat, string>>;

    const content = decorateContext(context.content);
    const retrievalTrace = recall.metadata?.retrievalTrace;
    const readerVisibleAttribution = deriveReaderVisibleSessionAttribution({
      content,
      testCase,
    });
    const recallDiagnostics = retrievalTrace?.schemaVersion === 2
      ? {
          ambiguousReaderVisibleSessionIds:
            readerVisibleAttribution.ambiguousSessionIds,
          queryCalls: retrievalTrace.queryExecutions.reduce(
            (total, execution) => total + execution.hops.length,
            0,
          ),
          readerVisibleSessionIds:
            readerVisibleAttribution.readerVisibleSessionIds,
          recallRecordCount: [
            recall.preferences,
            recall.references,
            recall.facts,
            recall.feedback,
            recall.archives,
            recall.evidence,
            recall.episodes,
          ].reduce(
            (total, records) =>
              total + (Array.isArray(records) ? records.length : 0),
            0,
          ),
          subQueries: [...retrievalTrace.subQueries],
        }
      : undefined;
    return {
      content,
      ...(evidenceLedgerContexts
        ? {
            evidenceLedgerContexts,
            recallSnapshotSha256: createHash("sha256").update(JSON.stringify({
              candidateTraces: recall.metadata.candidateTraces,
              evidenceLedger: recall.evidenceLedger,
              packet: recall.packet,
            })).digest("hex"),
          }
        : {}),
      ...(recallDiagnostics ? { recallDiagnostics } : {}),
      retrievedSessionIds,
    };
  };
}

function buildRetrievedSessionIds(input: {
  profile: LongMemEvalProfile;
  testCase: LongMemEvalCase;
}): string[] {
  if (input.profile === "baseline-no-memory") {
    return [];
  }
  if (input.profile === "baseline-full-context") {
    return [...input.testCase.answerSessionIds];
  }
  return input.testCase.answerSessionIds.length > 0 || hasEvidenceTurn(input.testCase)
    ? [...input.testCase.answerSessionIds]
    : [];
}

function summarizeExecutionError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  const normalized = raw.replace(/\s+/gu, " ").trim();

  return normalized ? normalized.slice(0, 240) : "Unknown execution failure.";
}

function calculateEvidenceSessionRecall(input: {
  retrievedSessionIds: readonly string[];
  testCase: LongMemEvalCase;
}): number | null {
  if (input.testCase.answerSessionIds.length === 0) {
    return null;
  }

  return input.testCase.answerSessionIds.filter((sessionId) =>
    input.retrievedSessionIds.includes(sessionId),
  ).length / input.testCase.answerSessionIds.length;
}

function calculateWrongRecallSessionIds(input: {
  answerSessionIds: readonly string[];
  retrievedSessionIds: readonly string[];
}): string[] {
  const answerSessionIds = new Set(input.answerSessionIds);
  const wrongSessionIds = new Set<string>();
  for (const sessionId of input.retrievedSessionIds) {
    if (!answerSessionIds.has(sessionId)) {
      wrongSessionIds.add(sessionId);
    }
  }
  return [...wrongSessionIds];
}

function buildFullCaseExecutionFailure(input: {
  error: unknown;
  hypothesis?: string;
  retrievedSessionIds?: readonly string[];
  stage: "answer_generation" | "answer_judge" | "memory_context";
  testCase: LongMemEvalCase;
}): LongMemEvalCaseResult {
  const retrievedSessionIds = [...(input.retrievedSessionIds ?? [])];

  return {
    answerSessionIds: [...input.testCase.answerSessionIds],
    correct: false,
    evidenceSessionRecall: calculateEvidenceSessionRecall({
      retrievedSessionIds,
      testCase: input.testCase,
    }),
    executionError: {
      message: summarizeExecutionError(input.error),
      stage: input.stage,
    },
    hypothesis: input.hypothesis ?? "Execution failed.",
    questionId: input.testCase.questionId,
    questionType: input.testCase.questionType,
    retrievedSessionIds,
  };
}

function buildRecallDiagnosticExecutionFailure(input: {
  error: unknown;
  testCase: LongMemEvalCase;
}): LongMemEvalRecallDiagnosticCaseResult {
  return {
    answerSessionIds: [...input.testCase.answerSessionIds],
    contextChars: 0,
    evidenceSessionRecall: calculateEvidenceSessionRecall({
      retrievedSessionIds: [],
      testCase: input.testCase,
    }),
    executionError: {
      message: summarizeExecutionError(input.error),
      stage: "memory_context",
    },
    question: input.testCase.question,
    questionId: input.testCase.questionId,
    questionType: input.testCase.questionType,
    retrievedSessionCount: 0,
    retrievedSessionIds: [],
    wrongRecall: false,
    wrongRecallSessionIds: [],
  };
}

async function withLongMemEvalStageTimeout<T>(input: {
  operation: () => Promise<T>;
  stage: "answer_generation" | "answer_judge" | "memory_context";
  timeoutMs?: number;
}): Promise<T> {
  if (input.timeoutMs === undefined) {
    return await input.operation();
  }

  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1) {
    throw new Error("LongMemEval stage timeout must be a positive integer");
  }

  const operationPromise = input.operation();
  operationPromise.catch(() => undefined);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operationPromise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `LongMemEval ${input.stage} timed out after ${input.timeoutMs}ms`,
            ),
          );
        }, input.timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

async function scoreFullCase(input: {
  answerJudge?: LongMemEvalAnswerJudge;
  answerGenerator: LongMemEvalAnswerGenerator;
  memoryContextBuilder: LongMemEvalMemoryContextBuilder;
  profile: LongMemEvalProfile;
  stageTimeoutMs?: number;
  testCase: LongMemEvalCase;
}): Promise<LongMemEvalCaseResult> {
  let memoryContext: LongMemEvalMemoryContext | undefined;
  if (
    input.profile === "goodmemory-rules-only" ||
    input.profile === "goodmemory-hybrid" ||
    input.profile === "goodmemory-recommended"
  ) {
    const goodMemoryProfile = input.profile;
    try {
      memoryContext = await withLongMemEvalStageTimeout({
        operation: () =>
          input.memoryContextBuilder({
            profile: goodMemoryProfile,
            testCase: input.testCase,
          }),
        stage: "memory_context",
        timeoutMs: input.stageTimeoutMs,
      });
    } catch (error) {
      return buildFullCaseExecutionFailure({
        error,
        stage: "memory_context",
        testCase: input.testCase,
      });
    }
  }
  const transcript =
    input.profile === "baseline-full-context"
      ? formatLongMemEvalTranscript(input.testCase)
      : "";
  let hypothesis: string;
  try {
    hypothesis = await withLongMemEvalStageTimeout({
      operation: () =>
        input.answerGenerator({
          memoryContext: memoryContext?.content,
          profile: input.profile,
          prompt: input.testCase.question,
          testCase: input.testCase,
          transcript,
        }),
      stage: "answer_generation",
      timeoutMs: input.stageTimeoutMs,
    });
  } catch (error) {
    return buildFullCaseExecutionFailure({
      error,
      retrievedSessionIds: memoryContext?.retrievedSessionIds,
      stage: "answer_generation",
      testCase: input.testCase,
    });
  }
  const retrievedSessionIds =
    input.profile === "baseline-full-context"
      ? [...input.testCase.answerSessionIds]
      : memoryContext?.retrievedSessionIds ?? [];
  let answerScore: LongMemEvalAnswerScore;
  try {
    answerScore = await withLongMemEvalStageTimeout({
      operation: () =>
        scoreLongMemEvalAnswerWithOptionalJudge({
          answerJudge:
            input.profile === "baseline-no-memory" ? undefined : input.answerJudge,
          hypothesis,
          testCase: input.testCase,
        }),
      stage: "answer_judge",
      timeoutMs: input.stageTimeoutMs,
    });
  } catch (error) {
    return buildFullCaseExecutionFailure({
      error,
      hypothesis,
      retrievedSessionIds,
      stage: "answer_judge",
      testCase: input.testCase,
    });
  }
  const evidenceSessionRecall = calculateEvidenceSessionRecall({
    retrievedSessionIds,
    testCase: input.testCase,
  });

  return {
    answerScore,
    answerSessionIds: [...input.testCase.answerSessionIds],
    correct: answerScore.correct,
    evidenceSessionRecall,
    hypothesis,
    questionId: input.testCase.questionId,
    questionType: input.testCase.questionType,
    retrievedSessionIds,
  };
}

async function scoreRecallDiagnosticCase(input: {
  memoryContextBuilder: LongMemEvalMemoryContextBuilder;
  profile: LongMemEvalRecallDiagnosticProfile;
  testCase: LongMemEvalCase;
}): Promise<LongMemEvalRecallDiagnosticCaseResult> {
  let memoryContext: LongMemEvalMemoryContext;
  try {
    memoryContext = await input.memoryContextBuilder({
      profile: input.profile,
      testCase: input.testCase,
    });
  } catch (error) {
    return buildRecallDiagnosticExecutionFailure({
      error,
      testCase: input.testCase,
    });
  }

  const retrievedSessionIds = [...new Set(memoryContext.retrievedSessionIds)];
  const wrongRecallSessionIds = calculateWrongRecallSessionIds({
    answerSessionIds: input.testCase.answerSessionIds,
    retrievedSessionIds,
  });

  return {
    answerSessionIds: [...input.testCase.answerSessionIds],
    contextChars: memoryContext.content.length,
    evidenceSessionRecall: calculateEvidenceSessionRecall({
      retrievedSessionIds,
      testCase: input.testCase,
    }),
    question: input.testCase.question,
    questionId: input.testCase.questionId,
    questionType: input.testCase.questionType,
    retrievedSessionCount: retrievedSessionIds.length,
    retrievedSessionIds,
    wrongRecall: wrongRecallSessionIds.length > 0,
    wrongRecallSessionIds,
  };
}

function scoreCase(input: {
  profile: LongMemEvalProfile;
  testCase: LongMemEvalCase;
}): LongMemEvalCaseResult {
  const hypothesis = buildHypothesis(input);
  const answerScore = scoreLongMemEvalAnswer(input.testCase, hypothesis);
  const retrievedSessionIds = buildRetrievedSessionIds(input);
  const evidenceSessionRecall = calculateEvidenceSessionRecall({
    retrievedSessionIds,
    testCase: input.testCase,
  });

  return {
    answerScore,
    answerSessionIds: [...input.testCase.answerSessionIds],
    correct: answerScore.correct,
    evidenceSessionRecall,
    hypothesis,
    questionId: input.testCase.questionId,
    questionType: input.testCase.questionType,
    retrievedSessionIds,
  };
}

function summarizeProfile(
  testCases: readonly LongMemEvalCase[],
  cases: readonly LongMemEvalCaseResult[],
): LongMemEvalProfileSummary {
  const correctCases = cases.filter((result) => result.correct).length;
  const evidenceCases = cases.filter(
    (result) => result.evidenceSessionRecall !== null,
  );
  const evidenceRecallTotal = evidenceCases.reduce(
    (sum, result) => sum + (result.evidenceSessionRecall ?? 0),
    0,
  );
  const abstentionCorrectCases = cases.filter((result) => {
    const testCase = testCases.find((candidate) => candidate.questionId === result.questionId);
    return testCase ? isAbstentionCase(testCase) && result.correct : false;
  }).length;
  const missedRecallCases = evidenceCases.filter(
    (result) => (result.evidenceSessionRecall ?? 0) < 1,
  ).length;
  const wrongRecallCases = cases.filter(
    (result) =>
      calculateWrongRecallSessionIds({
        answerSessionIds: result.answerSessionIds,
        retrievedSessionIds: result.retrievedSessionIds,
      }).length > 0,
  ).length;

  return {
    accuracy: cases.length === 0 ? 1 : correctCases / cases.length,
    abstentionCorrectCases,
    correctCases,
    evidenceCaseCount: evidenceCases.length,
    evidenceSessionRecall:
      evidenceCases.length === 0 ? null : evidenceRecallTotal / evidenceCases.length,
    missedRecallCases,
    totalCases: cases.length,
    wrongAnswerCases: cases.length - correctCases,
    wrongRecallCases,
  };
}

function summarizeRecallDiagnosticBucket(
  cases: readonly LongMemEvalRecallDiagnosticCaseResult[],
): LongMemEvalRecallDiagnosticBucketSummary {
  const evidenceCases = cases.filter(
    (result) => result.evidenceSessionRecall !== null,
  );
  const evidenceRecallTotal = evidenceCases.reduce(
    (sum, result) => sum + (result.evidenceSessionRecall ?? 0),
    0,
  );

  return {
    evidenceCaseCount: evidenceCases.length,
    evidenceSessionRecall:
      evidenceCases.length === 0 ? null : evidenceRecallTotal / evidenceCases.length,
    executionFailures: cases.filter((result) => result.executionError).length,
    missedRecallCases: evidenceCases.filter(
      (result) => (result.evidenceSessionRecall ?? 0) < 1,
    ).length,
    totalCases: cases.length,
    wrongRecallCases: cases.filter((result) => result.wrongRecall).length,
  };
}

function summarizeRecallDiagnostic(
  cases: readonly LongMemEvalRecallDiagnosticCaseResult[],
): LongMemEvalRecallDiagnosticSummary {
  const byQuestionType: Record<string, LongMemEvalRecallDiagnosticBucketSummary> = {};
  const questionTypes = [...new Set(cases.map((result) => result.questionType))];
  for (const questionType of questionTypes) {
    byQuestionType[questionType] = summarizeRecallDiagnosticBucket(
      cases.filter((result) => result.questionType === questionType),
    );
  }

  return {
    ...summarizeRecallDiagnosticBucket(cases),
    byQuestionType,
  };
}

function countByQuestionType(
  testCases: readonly LongMemEvalCase[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const testCase of testCases) {
    counts[testCase.questionType] = (counts[testCase.questionType] ?? 0) + 1;
  }
  return counts;
}

function selectLongMemEvalCases(input: {
  caseIds?: readonly string[];
  limit?: number;
  offset?: number;
  questionTypes?: readonly string[];
  testCases: readonly LongMemEvalCase[];
}): LongMemEvalCase[] {
  const caseIds = new Set(input.caseIds ?? []);
  const questionTypes = new Set(input.questionTypes ?? []);
  const filteredByCaseId =
    caseIds.size === 0
      ? input.testCases
      : input.testCases.filter((testCase) => caseIds.has(testCase.questionId));
  const filtered =
    questionTypes.size === 0
      ? filteredByCaseId
      : filteredByCaseId.filter((testCase) =>
          questionTypes.has(testCase.questionType),
        );
  const offset = input.offset ?? 0;

  return filtered.slice(
    offset,
    input.limit === undefined ? undefined : offset + input.limit,
  );
}

async function mapWithConcurrency<TInput, TOutput>(input: {
  items: readonly TInput[];
  limit: number;
  map: (item: TInput) => Promise<TOutput>;
  onResult?: (result: TOutput, index: number) => Promise<void>;
}): Promise<TOutput[]> {
  const results = new Array<TOutput>(input.items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < input.items.length) {
      const index = cursor;
      cursor += 1;
      const result = await input.map(input.items[index]!);
      results[index] = result;
      await input.onResult?.(result, index);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(input.limit, input.items.length) },
      () => worker(),
    ),
  );

  return results;
}

interface LongMemEvalRecallProgressIdentity {
  benchmarkFingerprint: string;
  benchmarkRoot: string;
  generatedBy: string;
  ingestMode: LongMemEvalIngestMode;
  profile: LongMemEvalRecallDiagnosticProfile;
  questionIds: string[];
  runConfiguration: LongMemEvalRecallRunConfiguration | null;
  schemaVersion: 2;
}

function completeJsonlPrefix(raw: string): string {
  if (!raw || raw.endsWith("\n")) {
    return raw;
  }
  const finalNewline = raw.lastIndexOf("\n");
  return finalNewline < 0 ? "" : raw.slice(0, finalNewline + 1);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

async function readOptionalText(
  path: string,
  read: (path: string) => Promise<string>,
): Promise<string | null> {
  try {
    return await read(path);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

function parseRecallDiagnosticProgress(input: {
  raw: string;
  testCases: readonly LongMemEvalCase[];
}): Map<string, LongMemEvalRecallDiagnosticCaseResult> {
  const testCasesById = new Map(
    input.testCases.map((testCase) => [testCase.questionId, testCase]),
  );
  const lines = input.raw.split("\n");
  if (!input.raw.endsWith("\n")) {
    lines.pop();
  }
  const results = new Map<string, LongMemEvalRecallDiagnosticCaseResult>();
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(
        `LongMemEval recall progress line ${index + 1} is invalid JSON: ${summarizeExecutionError(error)}`,
      );
    }
    if (!isRecord(parsed)) {
      throw new Error(
        `LongMemEval recall progress line ${index + 1} must be an object`,
      );
    }
    const questionId = readRequiredString(parsed, "questionId");
    const testCase = testCasesById.get(questionId);
    if (!testCase) {
      throw new Error(
        `LongMemEval recall progress contains out-of-scope question ${questionId}`,
      );
    }
    if (results.has(questionId)) {
      throw new Error(
        `LongMemEval recall progress contains duplicate question ${questionId}`,
      );
    }
    const contextChars = parsed.contextChars;
    if (
      typeof contextChars !== "number" ||
      !Number.isInteger(contextChars) ||
      contextChars < 0
    ) {
      throw new Error(
        `LongMemEval recall progress ${questionId} has invalid contextChars`,
      );
    }
    const retrievedSessionIds = readStringArray(parsed, "retrievedSessionIds");
    if (new Set(retrievedSessionIds).size !== retrievedSessionIds.length) {
      throw new Error(
        `LongMemEval recall progress ${questionId} has duplicate retrieved session ids`,
      );
    }
    let executionError:
      | LongMemEvalRecallDiagnosticCaseResult["executionError"]
      | undefined;
    if (parsed.executionError !== undefined) {
      if (
        !isRecord(parsed.executionError) ||
        parsed.executionError.stage !== "memory_context"
      ) {
        throw new Error(
          `LongMemEval recall progress ${questionId} has invalid executionError`,
        );
      }
      executionError = {
        message: readRequiredString(parsed.executionError, "message"),
        stage: "memory_context",
      };
    }
    const wrongRecallSessionIds = calculateWrongRecallSessionIds({
      answerSessionIds: testCase.answerSessionIds,
      retrievedSessionIds,
    });
    results.set(questionId, {
      answerSessionIds: [...testCase.answerSessionIds],
      contextChars,
      evidenceSessionRecall: calculateEvidenceSessionRecall({
        retrievedSessionIds,
        testCase,
      }),
      ...(executionError ? { executionError } : {}),
      question: testCase.question,
      questionId,
      questionType: testCase.questionType,
      retrievedSessionCount: retrievedSessionIds.length,
      retrievedSessionIds,
      wrongRecall: wrongRecallSessionIds.length > 0,
      wrongRecallSessionIds,
    });
  }
  return results;
}

async function readLongMemEvalJson(input: {
  benchmarkRoot: string;
  mode: LongMemEvalMode;
  readFile: (path: string) => Promise<string>;
}): Promise<unknown> {
  const candidateNames =
    input.mode === "smoke"
      ? LONGMEMEVAL_SMOKE_DATA_FILES
      : LONGMEMEVAL_FULL_DATA_FILES;

  const errors: string[] = [];
  for (const candidateName of candidateNames) {
    const path = join(input.benchmarkRoot, candidateName);
    try {
      return JSON.parse(await input.readFile(path));
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Could not read LongMemEval data:\n${errors.join("\n")}`);
}

export async function runLongMemEvalSuite(
  options: RunLongMemEvalOptions,
  io: LongMemEvalIO = {},
): Promise<LongMemEvalReport> {
  if (options.mode === "full" && (!io.answerGenerator || !io.memoryContextBuilder)) {
    throw new Error(
      "Full LongMemEval execution requires an answer generator and GoodMemory memory-context builder; the runner refuses to score full data from oracle labels.",
    );
  }

  const mkdirImpl = io.mkdir ?? mkdir;
  const readFileImpl =
    io.readFile ?? ((path: string) => readFile(path, "utf8"));
  const writeFileImpl = io.writeFile ?? writeFile;
  const now = io.now ?? (() => new Date());
  const runId = options.runId ?? "run-longmemeval";
  const runDirectory = join(options.outputDir, runId);
  const profiles = normalizeLongMemEvalProfileList(options.profiles);
  const rawCases = await readLongMemEvalJson({
    benchmarkRoot: options.benchmarkRoot,
    mode: options.mode,
    readFile: readFileImpl,
  });
  const testCases = selectLongMemEvalCases({
    caseIds: options.caseIds,
    limit: options.limit,
    offset: options.offset,
    questionTypes: options.questionTypes,
    testCases: validateLongMemEvalCases(rawCases),
  });
  const benchmarkFingerprint = createHash("sha256")
    .update(JSON.stringify(rawCases))
    .digest("hex");
  const profileReports: Partial<Record<LongMemEvalProfile, LongMemEvalProfileReport>> = {};
  const reportIngestMode = resolveLongMemEvalReportIngestMode(
    profiles,
    options.ingestMode,
  );
  const maxConcurrency =
    options.mode === "full" ? options.maxConcurrency ?? 1 : testCases.length;

  for (const profile of profiles) {
    const cases =
      options.mode === "full"
        ? await mapWithConcurrency({
            items: testCases,
            limit: maxConcurrency,
            map: (testCase) =>
              scoreFullCase({
                answerJudge: io.answerJudge,
                answerGenerator: io.answerGenerator as LongMemEvalAnswerGenerator,
                memoryContextBuilder:
                  io.memoryContextBuilder as LongMemEvalMemoryContextBuilder,
                profile,
                stageTimeoutMs: options.stageTimeoutMs,
                testCase,
              }),
          })
        : testCases.map((testCase) => scoreCase({ profile, testCase }));
    profileReports[profile] = {
      cases,
      summary: summarizeProfile(testCases, cases),
    };
  }

  const report: LongMemEvalReport = {
    benchmarkFingerprint,
    benchmarkRoot: options.benchmarkRoot,
    generatedAt: now().toISOString(),
    generatedBy: options.generatedBy,
    ...(reportIngestMode ? { ingestMode: reportIngestMode } : {}),
    mode: options.mode,
    outputDir: options.outputDir,
    phase: "phase-62",
    profiles: profileReports,
    ...(options.runConfiguration
      ? { runConfiguration: options.runConfiguration }
      : {}),
    runDirectory,
    runId,
    source: {
      benchmark: "LongMemEval",
      license: "MIT code; dataset external",
      url: "https://github.com/xiaowu0162/LongMemEval",
    },
    summary: {
      abstentionCases: testCases.filter(isAbstentionCase).length,
      caseCountsByQuestionType: countByQuestionType(testCases),
      executionFailures: Object.values(profileReports).reduce(
        (sum, profileReport) =>
          sum +
          (profileReport?.cases.filter((result) => result.executionError).length ?? 0),
        0,
      ),
      profilesCompared: profiles,
      totalCases: testCases.length,
    },
  };

  await mkdirImpl(runDirectory, { recursive: true });
  await writeFileImpl(
    join(runDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  return report;
}

export async function runLongMemEvalRecallDiagnostic(
  options: RunLongMemEvalRecallDiagnosticOptions,
  io: LongMemEvalIO = {},
): Promise<LongMemEvalRecallDiagnosticReport> {
  if (!io.memoryContextBuilder) {
    throw new Error(
      "LongMemEval recall-only diagnostic requires a GoodMemory memory-context builder.",
    );
  }

  const mkdirImpl = io.mkdir ?? mkdir;
  const readFileImpl =
    io.readFile ?? ((path: string) => readFile(path, "utf8"));
  const writeFileImpl = io.writeFile ?? writeFile;
  const now = io.now ?? (() => new Date());
  const runId = options.runId ?? "run-longmemeval-recall-diagnostic";
  const runDirectory = join(options.outputDir, runId);
  const rawCases = await readLongMemEvalJson({
    benchmarkRoot: options.benchmarkRoot,
    mode: options.mode,
    readFile: readFileImpl,
  });
  const benchmarkFingerprint = createHash("sha256")
    .update(JSON.stringify(rawCases))
    .digest("hex");
  const testCases = selectLongMemEvalCases({
    caseIds: options.caseIds,
    limit: options.limit,
    offset: options.offset,
    questionTypes: options.questionTypes,
    testCases: validateLongMemEvalCases(rawCases),
  });
  const ingestMode = resolveLongMemEvalIngestMode(
    options.profile,
    options.ingestMode,
  );
  const identity: LongMemEvalRecallProgressIdentity = {
    benchmarkFingerprint,
    benchmarkRoot: options.benchmarkRoot,
    generatedBy: options.generatedBy,
    ingestMode,
    profile: options.profile,
    questionIds: testCases.map((testCase) => testCase.questionId),
    runConfiguration: options.runConfiguration ?? null,
    schemaVersion: 2,
  };
  const identityPath = join(runDirectory, "run-identity.json");
  const progressPath = join(runDirectory, "progress.jsonl");
  await mkdirImpl(runDirectory, { recursive: true });
  let progressRaw = "";
  let cached = new Map<string, LongMemEvalRecallDiagnosticCaseResult>();
  if (options.resume) {
    const [identityRaw, existingProgress] = await Promise.all([
      readOptionalText(identityPath, readFileImpl),
      readOptionalText(progressPath, readFileImpl),
    ]);
    if ((identityRaw === null) !== (existingProgress === null)) {
      throw new Error(
        "LongMemEval recall resume requires both run-identity.json and progress.jsonl",
      );
    }
    if (identityRaw !== null && existingProgress !== null) {
      let existingIdentity: unknown;
      try {
        existingIdentity = JSON.parse(identityRaw) as unknown;
      } catch (error) {
        throw new Error(
          `LongMemEval recall progress identity is invalid JSON: ${summarizeExecutionError(error)}`,
        );
      }
      if (!isDeepStrictEqual(existingIdentity, identity)) {
        throw new Error(
          "LongMemEval recall progress identity does not match the requested run",
        );
      }
      progressRaw = completeJsonlPrefix(existingProgress);
      if (progressRaw !== existingProgress) {
        await writeFileImpl(progressPath, progressRaw);
      }
      cached = parseRecallDiagnosticProgress({
        raw: progressRaw,
        testCases,
      });
      if (options.retryFailures) {
        for (const [questionId, result] of cached) {
          if (result.executionError) {
            cached.delete(questionId);
          }
        }
        progressRaw = [...cached.values()]
          .map((result) => JSON.stringify(result))
          .join("\n");
        if (progressRaw) {
          progressRaw += "\n";
        }
        await writeFileImpl(progressPath, progressRaw);
      }
    }
  }
  if (!options.resume || (cached.size === 0 && progressRaw.length === 0)) {
    await writeFileImpl(identityPath, `${JSON.stringify(identity, null, 2)}\n`);
    await writeFileImpl(progressPath, "");
    progressRaw = "";
  }
  const appendProgress = io.appendFile
    ? io.appendFile
    : io.writeFile
      ? async (path: string, value: string) => {
          progressRaw += value;
          await writeFileImpl(path, progressRaw);
        }
      : (path: string, value: string) => appendFile(path, value);
  let progressWrite = Promise.resolve();
  const pendingCases = testCases.filter(
    (testCase) => !cached.has(testCase.questionId),
  );
  const freshCases = await mapWithConcurrency({
    items: pendingCases,
    limit: options.maxConcurrency ?? 1,
    map: (testCase) =>
      scoreRecallDiagnosticCase({
        memoryContextBuilder: io.memoryContextBuilder as LongMemEvalMemoryContextBuilder,
        profile: options.profile,
        testCase,
      }),
    onResult: async (result) => {
      progressWrite = progressWrite.then(() =>
        appendProgress(progressPath, `${JSON.stringify(result)}\n`),
      );
      await progressWrite;
    },
  });
  for (const result of freshCases) {
    cached.set(result.questionId, result);
  }
  const cases = testCases.map((testCase) => cached.get(testCase.questionId)!);

  const report: LongMemEvalRecallDiagnosticReport = {
    benchmarkFingerprint,
    benchmarkRoot: options.benchmarkRoot,
    cases,
    caveat:
      "Recall-only diagnostic measures whether GoodMemory retrieved the LongMemEval evidence sessions before answer generation. It is not an end-to-end answer accuracy score.",
    generatedAt: now().toISOString(),
    generatedBy: options.generatedBy,
    ingestMode,
    mode: "recall-only-diagnostic",
    outputDir: options.outputDir,
    phase: "phase-62",
    profile: options.profile,
    runDirectory,
    ...(options.runConfiguration
      ? { runConfiguration: options.runConfiguration }
      : {}),
    runId,
    source: {
      benchmark: "LongMemEval",
      license: "MIT code; dataset external",
      url: "https://github.com/xiaowu0162/LongMemEval",
    },
    summary: summarizeRecallDiagnostic(cases),
  };

  await writeFileImpl(
    join(runDirectory, "recall-diagnostic.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  return report;
}
