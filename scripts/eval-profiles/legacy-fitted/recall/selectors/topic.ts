/** Repo-only legacy-fitted topic overlap heuristics. */
import type { LanguageService } from "../../language";

const SELECTOR_TOPIC_STOPWORDS = new Set([
  "after",
  "before",
  "combined",
  "current",
  "currently",
  "days",
  "different",
  "does",
  "have",
  "hours",
  "many",
  "money",
  "months",
  "much",
  "since",
  "spend",
  "spent",
  "start",
  "this",
  "time",
  "total",
  "weeks",
  "what",
  "when",
  "where",
  "year",
  "years",
  "一共",
  "今年",
  "价格",
  "元",
  "合计",
  "多少",
  "多少钱",
  "总共",
  "相关",
  "花",
  "花了",
  "花费",
  "费用",
  "钱",
]);

function normalizeSelectorTopicToken(token: string): string {
  const normalized = token
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

  if (
    /^[a-z0-9]+$/u.test(normalized) &&
    normalized.length > 4 &&
    normalized.endsWith("s") &&
    !normalized.endsWith("ss") &&
    !normalized.endsWith("us") &&
    !normalized.endsWith("is")
  ) {
    return normalized.slice(0, -1);
  }

  return normalized;
}

export function selectorTopicTokens(
  text: string,
  language?: LanguageService,
  locale?: string,
): Set<string> {
  const tokens = language && locale
    ? language.tokenize(text, locale, { excludeStopwords: true })
    : (text.toLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)?/gu) ?? []);

  return new Set(
    tokens
      .flatMap((token) => token.split("-"))
      .map(normalizeSelectorTopicToken)
      .filter(
        (token) =>
          (/[\p{Script=Han}]/u.test(token) ? token.length >= 2 : token.length >= 4) &&
          !SELECTOR_TOPIC_STOPWORDS.has(token),
      ),
  );
}

export function selectorTopicOverlapCount(
  queryTopics: ReadonlySet<string>,
  factTopics: ReadonlySet<string>,
): number {
  let overlap = 0;

  for (const token of queryTopics) {
    if (factTopics.has(token)) {
      overlap += 1;
    }
  }

  return overlap;
}
