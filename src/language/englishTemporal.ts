import type { LanguageTemporalExpression } from "./contracts";

const MONTHS: Readonly<Record<string, number>> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const SEASONS: Readonly<Record<string, number>> = {
  spring: 3,
  summer: 6,
  fall: 9,
  autumn: 9,
  winter: 12,
};

const MONTH_PATTERN = Object.keys(MONTHS).join("|");
const SEASON_PATTERN = Object.keys(SEASONS).join("|");

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

function monthIndex(value: string): number | undefined {
  return MONTHS[value.toLowerCase()];
}

export function parseEnglishTemporalReference(
  text: string,
): LanguageTemporalExpression | undefined {
  const isoDate = text.match(
    /(?:^|[^\d])(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[^\d])/u,
  );
  if (isoDate) {
    return absolute(
      isoDate[0].trim(),
      Number(isoDate[1]),
      Number(isoDate[2]),
      Number(isoDate[3]),
    );
  }

  const monthDayYear = text.match(new RegExp(
    `\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`,
    "iu",
  ));
  if (monthDayYear) {
    return absolute(
      monthDayYear[0],
      Number(monthDayYear[3]),
      monthIndex(monthDayYear[1]!)!,
      Number(monthDayYear[2]),
    );
  }

  const dayMonthYear = text.match(new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\.?,?\\s+(\\d{4})\\b`,
    "iu",
  ));
  if (dayMonthYear) {
    return absolute(
      dayMonthYear[0],
      Number(dayMonthYear[3]),
      monthIndex(dayMonthYear[2]!)!,
      Number(dayMonthYear[1]),
    );
  }

  const monthYear = text.match(new RegExp(
    `\\b(${MONTH_PATTERN})\\.?,?\\s+(\\d{4})\\b`,
    "iu",
  ));
  if (monthYear) {
    return absolute(
      monthYear[0],
      Number(monthYear[2]),
      monthIndex(monthYear[1]!)!,
    );
  }

  const quarter = text.match(/\bQ([1-4])\s*(\d{4})\b/iu);
  if (quarter) {
    return absolute(
      quarter[0],
      Number(quarter[2]),
      (Number(quarter[1]) - 1) * 3 + 1,
    );
  }

  const seasonYear = text.match(new RegExp(
    `\\b(${SEASON_PATTERN})\\s+(\\d{4})\\b`,
    "iu",
  ));
  if (seasonYear) {
    return absolute(
      seasonYear[0],
      Number(seasonYear[2]),
      SEASONS[seasonYear[1]!.toLowerCase()]!,
    );
  }

  const unitsAgo = text.match(
    /\b(\d{1,3})\s+(day|week|month|year)s?\s+ago\b/iu,
  );
  if (unitsAgo) {
    return {
      kind: "relative",
      raw: unitsAgo[0],
      offset: -Number(unitsAgo[1]),
      unit: unitsAgo[2]!.toLowerCase() as "day" | "week" | "month" | "year",
    };
  }

  const relativeDay = text.match(/\b(yesterday|today|tomorrow)\b/iu);
  if (relativeDay) {
    const marker = relativeDay[1]!.toLowerCase();
    return {
      kind: "relative",
      raw: relativeDay[0],
      offset: marker === "yesterday" ? -1 : marker === "tomorrow" ? 1 : 0,
      unit: "day",
    };
  }

  const relativePeriod = text.match(
    /\b(last|this|next)\s+(week|month|quarter|year)\b/iu,
  );
  if (relativePeriod) {
    const direction = relativePeriod[1]!.toLowerCase();
    return {
      kind: "relative",
      raw: relativePeriod[0],
      offset: direction === "last" ? -1 : direction === "next" ? 1 : 0,
      unit: relativePeriod[2]!.toLowerCase() as
        | "week"
        | "month"
        | "quarter"
        | "year",
    };
  }

  const lastSeason = text.match(new RegExp(
    `\\blast\\s+(${SEASON_PATTERN})\\b`,
    "iu",
  ));
  if (lastSeason) {
    return {
      kind: "relative",
      raw: lastSeason[0],
      month: SEASONS[lastSeason[1]!.toLowerCase()]!,
      occurrence: "strictly_before",
      unit: "month",
    };
  }

  const lastMonth = text.match(new RegExp(
    `\\blast\\s+(${MONTH_PATTERN})\\b`,
    "iu",
  ));
  if (lastMonth) {
    return {
      kind: "relative",
      raw: lastMonth[0],
      month: monthIndex(lastMonth[1]!)!,
      occurrence: "strictly_before",
      unit: "month",
    };
  }

  const bareMonth = text.match(new RegExp(`\\b(${MONTH_PATTERN})\\b`, "iu"));
  if (bareMonth) {
    const token = bareMonth[1]!;
    if (token.toLowerCase() !== "may" || token === "May") {
      return {
        kind: "relative",
        raw: bareMonth[0],
        month: monthIndex(token)!,
        occurrence: "latest",
        unit: "month",
      };
    }
  }

  const year = text.match(/(?:^|[^\d])(\d{4})(?:$|[^\d-])/u);
  return year ? absolute(year[0].trim(), Number(year[1])) : undefined;
}
