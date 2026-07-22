import OpenCC from "opencc-js/t2cn";

import {
  normalizeUnicodeForEquality,
  tokenizeUnicodeText,
} from "./generic";

export const CHINESE_ANALYZER_VERSION = "7-opencc-t2cn-1.4.1";

const toSimplified = OpenCC.Converter({ from: "twp", to: "cn" });

export function normalizeChineseForEquality(text: string): string {
  return normalizeUnicodeForEquality(toSimplified(text));
}

export function tokenizeChineseForScoring(text: string): string[] {
  return tokenizeUnicodeText(toSimplified(text), "zh-CN");
}

export function buildChineseSearchTerms(text: string): string[] {
  const simplified = toSimplified(text);
  const variants = [text, simplified];
  return [...new Set(
    variants.flatMap((variant) => tokenizeUnicodeText(variant, "zh-CN")),
  )];
}
