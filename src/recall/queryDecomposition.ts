import type {
  LanguageQueryAnalysis,
  LanguageService,
  ResolvedLanguageContext,
} from "../language";
import { createLanguageService } from "../language";

// Query decomposition for multi-part questions.
//
// A single compound question ("What database do I use and which editor did I
// switch to?") makes one retrieval query that matches neither part well. The
// evidence is that decomposing into sub-questions and retrieving each
// separately lifts recall, and that the lift is *larger* on lexical/BM25
// retrievers than on dense ones (it is the embedding-free, lexical-compatible
// cousin of HyDE; HyDE itself needs dense embeddings and is deliberately not
// used here). IRCoT shows decomposed/iterated retrieval adds double-digit
// multi-hop recall on a pure BM25 stage (arXiv:2212.10509).
//
// This module is provider-free and generic over the recall result type, exactly
// like iterativeRecall: the caller supplies a `recall` closure (bound to
// scope/strategy) and a `merge` for its own result type, so it never touches the
// recall engine internals or the api-layer RecallResult, and stays unit-testable
// with fakes. The default decomposer is a deterministic heuristic splitter; an
// LLM decomposer can be injected via `decompose` when a provider is available.

const DEFAULT_MAX_SUB_QUERIES = 4;
const DEFAULT_MIN_SUB_QUERY_WORDS = 2;
const DEFAULT_LANGUAGE = createLanguageService();

function countTerms(
  text: string,
  language: QueryDecompositionOptions["language"],
  locale: string,
  excludeStopwords = false,
): number {
  return (language ?? DEFAULT_LANGUAGE).tokenize(text, locale, {
    excludeStopwords,
  }).length;
}

export interface QueryDecompositionOptions {
  analysis?: LanguageQueryAnalysis;
  /** Locale-aware tokenizer/sentence splitter used by the recall planner. */
  language?: Pick<
    LanguageService,
    | "analyzeQuery"
    | "decomposeQuery"
    | "normalizeForEquality"
    | "resolveFromText"
    | "tokenize"
  >;
  languageContext?: ResolvedLanguageContext;
  locale?: string;
  /** Maximum number of sub-queries to keep (excludes the original query). Default 4. */
  maxSubQueries?: number;
  /** Minimum word count for a fragment to count as a sub-query. Default 2. */
  minWords?: number;
}

/**
 * Deterministically split a compound query into sub-queries by clause and
 * coordinating-conjunction boundaries. Returns `[]` when the query has no
 * useful focused structure (so the caller falls back to a single recall).
 * Ordinary clauses require at least two fragments; one explicit temporal
 * operand is already a useful supplement to the original query. Pure and
 * deterministic.
 */
export function splitQueryIntoSubQueries(
  query: string,
  options?: QueryDecompositionOptions,
): string[] {
  const minWords = options?.minWords ?? DEFAULT_MIN_SUB_QUERY_WORDS;
  const normalized = query.trim();
  if (normalized.length === 0) {
    return [];
  }
  const language = options?.language ?? DEFAULT_LANGUAGE;
  const languageContext = options?.languageContext ??
    language.resolveFromText({
      ...(options?.locale ? { locale: options.locale } : {}),
      text: normalized,
    });
  const locale = languageContext.locale;
  const original = language.normalizeForEquality(
    normalized.replace(/[?.;!。？；！]+$/u, "").trim(),
    locale,
  );
  const temporalOperands = (options?.analysis ?? language.analyzeQuery(
    normalized,
    languageContext,
  )).temporalOperands ?? [];
  const fragments = temporalOperands.length > 0
    ? temporalOperands.slice(0, 2)
    : language.decomposeQuery(normalized, languageContext);
  const temporalKeys = new Set(
    temporalOperands.map((operand) =>
      language.normalizeForEquality(operand, locale)
    ),
  );

  const seen = new Set<string>();
  const subQueries: string[] = [];
  for (const fragment of fragments) {
    const key = language.normalizeForEquality(fragment, locale);
    if (
      key === original ||
      seen.has(key) ||
      countTerms(
        fragment,
        language,
        locale,
        temporalKeys.has(key),
      ) < (temporalKeys.has(key) ? 1 : minWords)
    ) {
      continue;
    }
    seen.add(key);
    subQueries.push(fragment);
  }
  const maxSubQueries = temporalOperands.length > 0
    ? Math.min(options?.maxSubQueries ?? DEFAULT_MAX_SUB_QUERIES, 2)
    : options?.maxSubQueries ?? DEFAULT_MAX_SUB_QUERIES;
  return subQueries.length >= (temporalOperands.length > 0 ? 1 : 2)
    ? subQueries.slice(0, maxSubQueries)
    : [];
}

export interface DecomposedRecallOutcome<TResult> {
  /** The sub-queries actually recalled (empty when the query did not decompose). */
  subQueries: string[];
  /** Total number of recall calls performed (1 when there was no decomposition). */
  queriesRun: number;
  /** The merged result, or the single primary result when there was no decomposition. */
  result: TResult;
}

/**
 * Decompose `query`, run `recall` for the original query and each sub-query, and
 * combine the results with the caller-supplied `merge`. When the query does not
 * decompose, returns the single primary recall unchanged (one recall call), so
 * this is a strict no-op for ordinary single-part queries. Provider-free: inject
 * an LLM `decompose` to upgrade beyond the default heuristic splitter.
 */
export async function decomposedRecall<TResult>(input: {
  query: string;
  recall: (query: string) => Promise<TResult>;
  merge: (primary: TResult, supplementary: TResult[]) => TResult;
  decompose?: (query: string) => string[] | Promise<string[]>;
  options?: QueryDecompositionOptions;
}): Promise<DecomposedRecallOutcome<TResult>> {
  const maxSubQueries = input.options?.maxSubQueries ?? DEFAULT_MAX_SUB_QUERIES;
  const decompose = input.decompose ?? ((query: string) =>
    splitQueryIntoSubQueries(query, input.options));
  const rawSubQueries = await decompose(input.query);

  const language = input.options?.language ?? DEFAULT_LANGUAGE;
  const locale = input.options?.locale ??
    language.resolveFromText({ text: input.query }).locale;
  const originalKey = language.normalizeForEquality(input.query.trim(), locale);
  const seen = new Set<string>();
  const subQueries: string[] = [];
  for (const candidate of rawSubQueries) {
    const trimmed = candidate.trim();
    const key = language.normalizeForEquality(trimmed, locale);
    if (trimmed.length === 0 || key === originalKey || seen.has(key)) {
      continue;
    }
    seen.add(key);
    subQueries.push(trimmed);
    if (subQueries.length >= maxSubQueries) {
      break;
    }
  }

  const primary = await input.recall(input.query);
  if (subQueries.length === 0) {
    return { subQueries: [], queriesRun: 1, result: primary };
  }
  const supplementary = await Promise.all(
    subQueries.map((subQuery) => input.recall(subQuery)),
  );
  return {
    subQueries,
    queriesRun: 1 + subQueries.length,
    result: input.merge(primary, supplementary),
  };
}
