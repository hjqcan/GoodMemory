import type { LanguagePack } from "./contracts";
import {
  emptyBehavioralRuleAnalysis,
  emptyContentAnalysis,
  emptyQueryAnalysis,
  matchesNormalizedEntityAlias,
  parseTechnicalTemporalExpressions,
  splitSentencesGeneric,
} from "./packHelpers";

const GENERIC_SEGMENTER_CACHE = new Map<string, Intl.Segmenter>();

function getSegmenter(locale: string): Intl.Segmenter | null {
  const SegmenterCtor = Intl.Segmenter;
  if (typeof SegmenterCtor !== "function") {
    return null;
  }

  const cacheKey = locale || "und";
  const cached = GENERIC_SEGMENTER_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  const segmenter = new SegmenterCtor(locale, {
    granularity: "word",
  });
  GENERIC_SEGMENTER_CACHE.set(cacheKey, segmenter);
  return segmenter;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeUnicodeForEquality(value: string): string {
  return normalizeWhitespace(
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\p{P}\p{S}]+/gu, " "),
  );
}

const QUOTE_PAIRS = [
  ["\"", "\""],
  ["'", "'"],
  ["`", "`"],
  ["“", "”"],
  ["‘", "’"],
  ["«", "»"],
  ["「", "」"],
  ["『", "』"],
] as const;
const QUOTE_CLOSINGS = new Map<string, string>(QUOTE_PAIRS);
const QUOTE_CHARACTERS = new Set<string>(QUOTE_PAIRS.flat());

interface QuotedTextScan {
  masked: string;
  unterminated: boolean;
}

export function isExplicitlyQuotedValue(value: string): boolean {
  const trimmed = value.trim();
  return QUOTE_PAIRS.some(([opening, closing]) =>
    trimmed.length > opening.length + closing.length &&
    trimmed.startsWith(opening) &&
    trimmed.endsWith(closing)
  );
}

function isWordApostrophe(value: string, index: number): boolean {
  return value[index] === "'" &&
    /[\p{L}\p{N}]/u.test(value[index - 1] ?? "") &&
    /[\p{L}\p{N}]/u.test(value[index + 1] ?? "");
}

function scanQuotedText(value: string): QuotedTextScan {
  const characters = value.split("");
  let closingQuote: string | undefined;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    if (closingQuote) {
      characters[index] = " ";
      if (character === closingQuote) {
        closingQuote = undefined;
      }
      continue;
    }
    if (isWordApostrophe(value, index)) {
      continue;
    }
    const closing = QUOTE_CLOSINGS.get(character);
    if (closing) {
      characters[index] = " ";
      closingQuote = closing;
    }
  }
  return {
    masked: characters.join(""),
    unterminated: closingQuote !== undefined,
  };
}

export function hasUnterminatedQuote(value: string): boolean {
  return scanQuotedText(value).unterminated;
}

export function maskQuotedText(value: string): string {
  const scan = scanQuotedText(value);
  return scan.unterminated ? value : scan.masked;
}

export function replaceUnquotedText(
  value: string,
  pattern: RegExp,
  replacement: string,
): string {
  let closingQuote: string | undefined;
  let output = "";
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (closingQuote) {
      if (character === closingQuote) {
        output += value.slice(start, index + 1);
        start = index + 1;
        closingQuote = undefined;
      }
      continue;
    }
    if (isWordApostrophe(value, index)) {
      continue;
    }
    const closing = QUOTE_CLOSINGS.get(character);
    if (closing) {
      output += value.slice(start, index).replace(pattern, replacement);
      start = index;
      closingQuote = closing;
    }
  }
  return closingQuote
    ? value.replace(pattern, replacement)
    : output + value.slice(start).replace(pattern, replacement);
}

export function collectProtectedRetrievalTokens(
  value: string,
  locale: string,
): ReadonlySet<string> {
  const quoted = replaceUnquotedText(value, /[\s\S]/gu, " ");
  return new Set(tokenizeUnicodeText(quoted, locale));
}

export function splitTrailingClause(
  value: string,
  isTrailingClause: (clause: string) => boolean,
  hasExplicitBoundary: (clause: string) => boolean =
    (clause) => /[?？]\s*$/u.test(maskQuotedText(clause)),
  isStandalonePreamble: (clause: string) => boolean = () => false,
): string[] {
  const masked = maskQuotedText(value);
  for (let index = masked.length - 1; index >= 0; index -= 1) {
    if (!/[,，、]/u.test(masked[index]!)) {
      continue;
    }
    const assertion = value.slice(0, index).trim();
    const question = value.slice(index + 1).trim();
    if (
      assertion &&
      question &&
      !isStandalonePreamble(assertion) &&
      !isTrailingClause(assertion) &&
      hasExplicitBoundary(question) &&
      isTrailingClause(question)
    ) {
      return [assertion, question];
    }
  }
  return [value.trim()].filter(Boolean);
}

export interface DirectiveGrammarMatch {
  clause: string;
  directive: string;
  prefix: string;
  suffix: string;
}

export function isolateDirectiveGrammar(
  clause: string,
  grammar: RegExp,
  hasReportedScope: (match: DirectiveGrammarMatch) => boolean = () => false,
): string {
  const trimmed = clause.trim();
  if (hasUnterminatedQuote(trimmed)) {
    return trimmed;
  }
  const unquoted = maskQuotedText(trimmed);
  const match = unquoted.match(grammar);
  const markerIndex = match?.index;
  if (!match || markerIndex === undefined) {
    return trimmed;
  }
  const prefix = unquoted.slice(0, markerIndex);
  const directive = unquoted.slice(markerIndex, markerIndex + match[0].length);
  const suffix = unquoted.slice(markerIndex + match[0].length);
  if (hasReportedScope({ clause: trimmed, directive, prefix, suffix })) {
    return "";
  }
  if (markerIndex === 0) {
    return trimmed;
  }
  const rawPrefix = trimmed.slice(0, markerIndex);
  const hasStructuredPrefix = /[=＝]/u.test(rawPrefix) ||
    [...rawPrefix].some((character) => QUOTE_CHARACTERS.has(character));
  return hasStructuredPrefix ? trimmed : trimmed.slice(markerIndex);
}

export function containsHanScript(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

function tokenizeHanSequence(sequence: string): string[] {
  if (sequence.length <= 2) {
    return [sequence];
  }

  const tokens = new Set<string>([sequence]);
  for (let index = 0; index < sequence.length - 1; index += 1) {
    tokens.add(sequence.slice(index, index + 2));
  }

  return [...tokens];
}

function fallbackTokenize(normalized: string): string[] {
  const parts = normalized.match(/[\p{Script=Han}]+|[\p{L}\p{N}_./-]+/gu) ?? [];
  const tokens: string[] = [];

  for (const part of parts) {
    if (containsHanScript(part)) {
      tokens.push(...tokenizeHanSequence(part));
      continue;
    }

    if (part.length >= 2) {
      tokens.push(part);
    }
  }

  return tokens;
}

export function tokenizeUnicodeText(
  value: string,
  locale: string,
): string[] {
  const normalized = normalizeUnicodeForEquality(value);
  if (!normalized) {
    return [];
  }

  const segmenter = getSegmenter(locale);
  if (!segmenter) {
    return fallbackTokenize(normalized);
  }

  const tokens: string[] = [];
  for (const segment of segmenter.segment(normalized)) {
    if (!segment.isWordLike) {
      continue;
    }

    const token = segment.segment.trim();
    if (!token) {
      continue;
    }

    if (containsHanScript(token)) {
      tokens.push(...tokenizeHanSequence(token));
      continue;
    }

    if (token.length >= 2) {
      tokens.push(token);
    }
  }

  return tokens.length > 0 ? tokens : fallbackTokenize(normalized);
}

export function splitClausesGeneric(content: string): string[] {
  const clauses = splitTopLevelSentenceClauses(content)
    .flatMap(splitLatinSentenceClauses)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return clauses.length > 0 ? clauses : [content.trim()].filter(Boolean);
}

function splitTopLevelSentenceClauses(content: string): string[] {
  const masked = maskQuotedText(content);
  const clauses: string[] = [];
  const boundaryPattern = /\r?\n+|[；;]+|[。！？!?]+/gu;
  let start = 0;
  for (const match of masked.matchAll(boundaryPattern)) {
    const lineBoundary = match[0].includes("\n");
    const end = match.index + (lineBoundary ? 0 : match[0].length);
    clauses.push(content.slice(start, end));
    start = match.index + match[0].length;
  }
  clauses.push(content.slice(start));
  return clauses;
}

function splitLatinSentenceClauses(content: string): string[] {
  const clauses: string[] = [];
  const boundaryPattern = /\.\s+(?=[A-Z\p{Script=Hangul}])/gu;
  const masked = maskQuotedText(content);
  let start = 0;
  for (const match of masked.matchAll(boundaryPattern)) {
    const boundary = match.index + 1;
    const prefix = content.slice(start, boundary);
    if (
      /(?:^|[^\p{L}])(?:\p{L}\.){2,}$/u.test(prefix) ||
      /(?:^|\s)[A-Z]\.$/u.test(prefix)
    ) {
      continue;
    }
    clauses.push(content.slice(start, boundary));
    start = match.index + match[0].length;
  }
  clauses.push(content.slice(start));
  return clauses;
}

export interface ExplicitFactCandidateClause {
  content: string;
  disposition: "fact" | "feedback" | "ordinary";
}

export type ExplicitFactParseResult =
  | {
    clauses: ExplicitFactCandidateClause[];
    status: "complete";
  }
  | {
    clauses: ExplicitFactCandidateClause[];
    status: "incomplete-counted-list";
  }
  | {
    clauses: ExplicitFactCandidateClause[];
    status: "invalid";
  };

export function expandExplicitFactCandidateClauses(
  content: string,
  parseExplicitFacts: (
    value: string,
  ) => ExplicitFactParseResult | undefined,
  splitClauses: (value: string) => string[] = splitClausesGeneric,
): ExplicitFactCandidateClause[] {
  const expanded: ExplicitFactCandidateClause[] = [];
  const clauses = splitClauses(content);
  for (let index = 0; index < clauses.length; index += 1) {
    let end = index;
    let parsed = parseExplicitFacts(clauses[index]!);
    if (parsed === undefined) {
      expanded.push({ content: clauses[index]!, disposition: "ordinary" });
      continue;
    }

    if (parsed.status === "invalid") {
      continue;
    }

    while (
      parsed.status === "incomplete-counted-list" &&
      end + 1 < clauses.length
    ) {
      end += 1;
      const extended = parseExplicitFacts(
        clauses.slice(index, end + 1).join("; "),
      );
      if (extended === undefined) {
        break;
      }
      parsed = extended;
    }
    if (parsed.status === "incomplete-counted-list") {
      return expanded;
    }
    if (parsed.status === "invalid") {
      index = end;
      continue;
    }
    expanded.push(...parsed.clauses);
    index = end;
  }
  return expanded;
}

export function createNeutralLanguagePack(): LanguagePack {
  return {
    analyzerVersion: "3",
    apiVersion: 1,
    compatibilityGroup: "neutral",
    defaultLocale: "und",
    id: "neutral",
    locales: [],
    detect() {
      return "none";
    },
    splitClauses(text: string): string[] {
      return splitClausesGeneric(text);
    },
    normalizeForEquality(text: string): string {
      return normalizeUnicodeForEquality(text);
    },
    splitSentences(text: string): string[] {
      return splitSentencesGeneric(text);
    },
    tokenizeForScoring(text: string): string[] {
      return tokenizeUnicodeText(text, "und");
    },
    buildSearchTerms(text: string): string[] {
      return tokenizeUnicodeText(text, "und");
    },
    decomposeQuery() {
      return [];
    },
    analyzeBehavioralRule() {
      return emptyBehavioralRuleAnalysis();
    },
    analyzeQuery() {
      return emptyQueryAnalysis();
    },
    analyzeContent() {
      return emptyContentAnalysis();
    },
    parseTemporalExpressions(text) {
      return parseTechnicalTemporalExpressions(text);
    },
    extractEntityMentions() {
      return [];
    },
    matchesEntityAlias(query, alias) {
      return matchesNormalizedEntityAlias(
        query,
        alias,
        normalizeUnicodeForEquality,
      );
    },
    acceptsEntityCandidate() {
      return true;
    },
    extractCandidates() {
      return [];
    },
    render({ key }) {
      return key;
    },
  };
}
