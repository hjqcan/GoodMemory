import type { LanguagePack } from "./contracts";
import {
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
  const clauses = content
    .split(
      /(?:\r?\n+)|(?<=[。！？；!?;])\s*|(?<=\.)(?<!\b[A-Z]\.)\s+(?=[A-Z])/u,
    )
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return clauses.length > 0 ? clauses : [content.trim()].filter(Boolean);
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
    analyzeQuery() {
      return emptyQueryAnalysis();
    },
    analyzeContent() {
      return emptyContentAnalysis();
    },
    parseTemporalExpressions(text) {
      return parseTechnicalTemporalExpressions(text);
    },
    resolveTemporalReference() {
      return undefined;
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
