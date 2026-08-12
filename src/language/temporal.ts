import {
  isIanaTimezone,
  isRfc3339Instant,
  resolveTemporalInterval,
} from "../domain/temporal";
import type { LanguageTemporalExpression } from "./contracts";

const TEMPORAL_LITERAL_QUOTE_PAIRS = [
  ["\"", "\""],
  ["'", "'"],
  ["‘", "’"],
  ["“", "”"],
  ["«", "»"],
  ["《", "》"],
  ["「", "」"],
  ["『", "』"],
] as const;

function maskRange(value: string, start: number, end: number): string {
  return `${value.slice(0, start)}${" ".repeat(end - start)}${value.slice(end)}`;
}

export function maskQuotedTemporalLiterals(text: string): string {
  let masked = text;
  for (const [opening, closing] of TEMPORAL_LITERAL_QUOTE_PAIRS) {
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const start = text.indexOf(opening, searchFrom);
      if (start < 0) break;
      const end = text.indexOf(closing, start + opening.length);
      if (end < 0) break;
      masked = maskRange(masked, start, end + closing.length);
      searchFrom = end + closing.length;
    }
  }
  return masked;
}

export function hasOccurrenceResolutionContext(input: {
  observedAt?: string;
  timezone?: string;
}): boolean {
  return Boolean(
    input.observedAt &&
      input.timezone &&
      isRfc3339Instant(input.observedAt) &&
      isIanaTimezone(input.timezone),
  );
}

export function canResolveOccurrenceExpression(input: {
  expression: LanguageTemporalExpression;
  locale: string;
  observedAt?: string;
  timezone?: string;
}): boolean {
  if (!hasOccurrenceResolutionContext(input)) {
    return false;
  }
  return resolveTemporalInterval(
    [input.expression],
    input.observedAt!,
    input.timezone!,
    input.locale,
  ) !== undefined;
}

function absolute(
  raw: string,
  year: number,
  month?: number,
  day?: number,
): LanguageTemporalExpression {
  return {
    kind: "absolute",
    raw,
    calendar: {
      ...(day === undefined ? {} : { day }),
      ...(month === undefined ? {} : { month }),
      year,
    },
  };
}

export function parseCjkTemporalReference(
  text: string,
): LanguageTemporalExpression | undefined {
  const isoDate = text.match(
    /(?:^|[^\d])(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[^\d])/u,
  );
  if (isoDate) {
    return absolute(
      isoDate[0].match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/u)![0],
      Number(isoDate[1]),
      Number(isoDate[2]),
      Number(isoDate[3]),
    );
  }

  const cjkDate = text.match(
    /(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*[日号號])?/u,
  );
  if (cjkDate) {
    return absolute(
      cjkDate[0],
      Number(cjkDate[1]),
      Number(cjkDate[2]),
      cjkDate[3] ? Number(cjkDate[3]) : undefined,
    );
  }

  const year = text.match(/(?:^|[^\d])(\d{4})(?:\s*年)(?:$|[^\d])/u);
  if (year) {
    return absolute(year[0].trim(), Number(year[1]));
  }

  const daysAgo = text.match(/(\d{1,3})\s*(?:天|日)前/u);
  if (daysAgo) {
    return {
      kind: "relative",
      raw: daysAgo[0],
      offset: -Number(daysAgo[1]),
      unit: "day",
    };
  }

  const relativeDays = [
    [/(?:前天|一昨日)/u, -2],
    [/(?:昨天|昨日)/u, -1],
    [/(?:今天|今日)/u, 0],
    [/(?:后天|後天|明後日)/u, 2],
    [/(?:明天|明日)/u, 1],
  ] as const;
  for (const [pattern, offset] of relativeDays) {
    const match = text.match(pattern);
    if (match) {
      return { kind: "relative", raw: match[0], offset, unit: "day" };
    }
  }

  const relativePeriods = [
    [/(?:上周|上週|先週)/u, "week", -1],
    [/(?:本周|本週|这周|這週|今週)/u, "week", 0],
    [/(?:下周|下週|来週)/u, "week", 1],
    [/(?:上个月|上個月|上月|先月)/u, "month", -1],
    [/(?:本个月|本個月|这(?:个|個)月|這(?:个|個)月|今月)/u, "month", 0],
    [/(?:下个月|下個月|下月|来月)/u, "month", 1],
    [/(?:上季度)/u, "quarter", -1],
    [/(?:本季度|这季度|這季度)/u, "quarter", 0],
    [/(?:下季度)/u, "quarter", 1],
    [/(?:去年|昨年|上年)/u, "year", -1],
    [/(?:今年|本年|这年|這年)/u, "year", 0],
    [/(?:明年|来年|下年)/u, "year", 1],
  ] as const;
  for (const [pattern, unit, offset] of relativePeriods) {
    const match = text.match(pattern);
    if (match) {
      return { kind: "relative", raw: match[0], offset, unit };
    }
  }
  return undefined;
}
