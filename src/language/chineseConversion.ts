import {
  normalizeUnicodeForEquality,
  tokenizeUnicodeText,
} from "./generic";

export const CHINESE_ANALYZER_VERSION = "11-reference-pointer";

export function normalizeChineseForEquality(text: string): string {
  return normalizeUnicodeForEquality(text);
}

export function tokenizeChineseForScoring(
  text: string,
  locale: string,
): string[] {
  return tokenizeUnicodeText(text, locale);
}

export function buildChineseSearchTerms(
  text: string,
  locale: string,
): string[] {
  return [...new Set(tokenizeUnicodeText(text, locale))];
}
