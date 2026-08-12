export type TemporalPrecision =
  | "instant"
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year";

export interface TemporalInterval {
  start: string;
  endExclusive: string;
  precision: TemporalPrecision;
  timezone: string;
}

export type TemporalExpression =
  | {
      kind: "absolute";
      raw: string;
      calendar: {
        day?: number;
        month?: number;
        year: number;
      };
      precision?: "quarter";
    }
  | {
      kind: "absolute";
      raw: string;
      iso: string;
    }
  | {
      kind: "relative";
      raw: string;
      offset: number;
      unit: "day" | "week" | "month" | "quarter" | "year";
    }
  | {
      kind: "relative";
      raw: string;
      month: number;
      occurrence: "latest" | "strictly_before";
      unit: "month";
    }
  | {
      kind: "range";
      raw: string;
      end?: string;
      start?: string;
    };

const RFC3339_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
const IANA_TIMEZONE_PATTERN =
  /^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/u;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isRfc3339Instant(value: string): boolean {
  const match = value.match(RFC3339_INSTANT_PATTERN);
  if (!match || match[4] === "-00:00") {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    Number.isFinite(Date.parse(value));
}

export function isIanaTimezone(timezone: string): boolean {
  if (!IANA_TIMEZONE_PATTERN.test(timezone)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function assertTemporalMessageContext(input: {
  observedAt?: string;
  timezone?: string;
}, label = "message"): void {
  if (input.observedAt !== undefined && !isRfc3339Instant(input.observedAt)) {
    throw new TypeError(`Invalid ${label}.observedAt: ${input.observedAt}`);
  }
  if (input.timezone !== undefined && !isIanaTimezone(input.timezone)) {
    throw new TypeError(`Invalid ${label}.timezone: ${input.timezone}`);
  }
}

export function assertRememberTemporalContext(input: {
  messages: readonly { observedAt?: string; timezone?: string }[];
  timezone?: string;
}): void {
  if (input.timezone !== undefined && !isIanaTimezone(input.timezone)) {
    throw new TypeError(`Invalid timezone: ${input.timezone}`);
  }
  input.messages.forEach((message, index) => {
    assertTemporalMessageContext(message, `messages[${index}]`);
  });
}

interface CalendarDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

type CalendarPrecision = Exclude<TemporalPrecision, "instant">;

const PARTS_LOCALE = "en-CA-u-ca-iso8601-nu-latn";
const PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timezone: string): Intl.DateTimeFormat {
  const existing = PARTS_FORMATTERS.get(timezone);
  if (existing) {
    return existing;
  }
  const formatter = new Intl.DateTimeFormat(PARTS_LOCALE, {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: timezone,
    year: "numeric",
  });
  PARTS_FORMATTERS.set(timezone, formatter);
  return formatter;
}

function zonedDateTime(instant: Date, timezone: string): CalendarDateTime {
  const values = new Map(
    partsFormatter(timezone).formatToParts(instant)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
  return {
    year: values.get("year")!,
    month: values.get("month")!,
    day: values.get("day")!,
    hour: values.get("hour")!,
    minute: values.get("minute")!,
    second: values.get("second")!,
  };
}

function calendarDate(
  year: number,
  month: number,
  day: number,
): Pick<CalendarDateTime, "day" | "month" | "year"> {
  const normalized = new Date(0);
  normalized.setUTCFullYear(year, month - 1, day);
  normalized.setUTCHours(0, 0, 0, 0);
  return {
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth() + 1,
    day: normalized.getUTCDate(),
  };
}

function addCalendarDays(
  date: Pick<CalendarDateTime, "day" | "month" | "year">,
  days: number,
): Pick<CalendarDateTime, "day" | "month" | "year"> {
  return calendarDate(date.year, date.month, date.day + days);
}

function addCalendarMonths(
  date: Pick<CalendarDateTime, "day" | "month" | "year">,
  months: number,
): Pick<CalendarDateTime, "day" | "month" | "year"> {
  return calendarDate(date.year, date.month + months, 1);
}

function localDateTimeAsUtc(input: CalendarDateTime): number {
  const date = new Date(0);
  date.setUTCFullYear(input.year, input.month - 1, input.day);
  date.setUTCHours(input.hour, input.minute, input.second, 0);
  return date.getTime();
}

function compareCalendarDateTime(
  left: CalendarDateTime,
  right: CalendarDateTime,
): number {
  return localDateTimeAsUtc(left) - localDateTimeAsUtc(right);
}

function calendarBoundaryInstant(
  date: Pick<CalendarDateTime, "day" | "month" | "year">,
  timezone: string,
): string | undefined {
  const target: CalendarDateTime = {
    ...date,
    hour: 0,
    minute: 0,
    second: 0,
  };
  let candidate = localDateTimeAsUtc(target);
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = zonedDateTime(new Date(candidate), timezone);
    const difference = compareCalendarDateTime(actual, target);
    if (difference === 0) {
      return new Date(candidate).toISOString();
    }
    candidate -= difference;
  }
  return undefined;
}

function weekFirstDay(locale: string): number {
  try {
    const resolved = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    return resolved.getWeekInfo?.().firstDay ?? resolved.weekInfo?.firstDay ?? 1;
  } catch {
    return 1;
  }
}

function dayOfWeek(date: Pick<CalendarDateTime, "day" | "month" | "year">): number {
  return new Date(localDateTimeAsUtc({
    ...date,
    hour: 0,
    minute: 0,
    second: 0,
  })).getUTCDay() || 7;
}

function isCalendarDate(
  date: Pick<CalendarDateTime, "day" | "month" | "year">,
): boolean {
  return Number.isInteger(date.year) &&
    date.year >= 1 &&
    date.year <= 9999 &&
    Number.isInteger(date.month) &&
    date.month >= 1 &&
    date.month <= 12 &&
    Number.isInteger(date.day) &&
    date.day >= 1 &&
    date.day <= daysInMonth(date.year, date.month);
}

function calendarInterval(
  startDate: Pick<CalendarDateTime, "day" | "month" | "year">,
  endDate: Pick<CalendarDateTime, "day" | "month" | "year">,
  precision: CalendarPrecision,
  timezone: string,
): TemporalInterval | undefined {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) {
    return undefined;
  }
  const start = calendarBoundaryInstant(startDate, timezone);
  const endExclusive = calendarBoundaryInstant(endDate, timezone);
  if (!start || !endExclusive || Date.parse(start) >= Date.parse(endExclusive)) {
    return undefined;
  }
  return { start, endExclusive, precision, timezone };
}

function relativeCalendarInterval(input: {
  expression: Extract<TemporalExpression, { kind: "relative" }>;
  locale: string;
  reference: CalendarDateTime;
  timezone: string;
}): TemporalInterval | undefined {
  const referenceDate = calendarDate(
    input.reference.year,
    input.reference.month,
    input.reference.day,
  );
  const expression = input.expression;
  if ("occurrence" in expression) {
    if (!Number.isInteger(expression.month) ||
      expression.month < 1 || expression.month > 12) {
      return undefined;
    }
    let year = referenceDate.year;
    if (
      expression.occurrence === "strictly_before"
        ? expression.month >= referenceDate.month
        : expression.month > referenceDate.month
    ) {
      year -= 1;
    }
    const start = calendarDate(year, expression.month, 1);
    return calendarInterval(
      start,
      addCalendarMonths(start, 1),
      "month",
      input.timezone,
    );
  }
  if (!Number.isInteger(expression.offset)) {
    return undefined;
  }
  if (expression.unit === "day") {
    const start = addCalendarDays(referenceDate, expression.offset);
    return calendarInterval(
      start,
      addCalendarDays(start, 1),
      "day",
      input.timezone,
    );
  }
  if (expression.unit === "week") {
    const firstDay = weekFirstDay(input.locale);
    const weekStart = addCalendarDays(
      referenceDate,
      -((dayOfWeek(referenceDate) - firstDay + 7) % 7) + expression.offset * 7,
    );
    return calendarInterval(
      weekStart,
      addCalendarDays(weekStart, 7),
      "week",
      input.timezone,
    );
  }
  if (expression.unit === "month") {
    const start = addCalendarMonths(referenceDate, expression.offset);
    return calendarInterval(
      start,
      addCalendarMonths(start, 1),
      "month",
      input.timezone,
    );
  }
  if (expression.unit === "quarter") {
    const currentQuarterStart = calendarDate(
      referenceDate.year,
      Math.floor((referenceDate.month - 1) / 3) * 3 + 1,
      1,
    );
    const start = addCalendarMonths(currentQuarterStart, expression.offset * 3);
    return calendarInterval(
      start,
      addCalendarMonths(start, 3),
      "quarter",
      input.timezone,
    );
  }
  const start = calendarDate(referenceDate.year + expression.offset, 1, 1);
  return calendarInterval(
    start,
    calendarDate(start.year + 1, 1, 1),
    "year",
    input.timezone,
  );
}

function absoluteCalendarInterval(input: {
  calendar: { day?: number; month?: number; year: number };
  precision?: "quarter";
  timezone: string;
}): TemporalInterval | undefined {
  const { day, month, year } = input.calendar;
  if (
    !Number.isInteger(year) || year < 1 || year > 9999 ||
    (month !== undefined && (
      !Number.isInteger(month) || month < 1 || month > 12
    )) ||
    (day !== undefined && (
      !Number.isInteger(day) || month === undefined ||
      day < 1 || day > daysInMonth(year, month)
    ))
  ) {
    return undefined;
  }
  const start = calendarDate(year, month ?? 1, day ?? 1);
  if (input.precision === "quarter") {
    if (day !== undefined || month === undefined || (month - 1) % 3 !== 0) {
      return undefined;
    }
    return calendarInterval(
      start,
      addCalendarMonths(start, 3),
      "quarter",
      input.timezone,
    );
  }
  if (day !== undefined) {
    return calendarInterval(
      start,
      addCalendarDays(start, 1),
      "day",
      input.timezone,
    );
  }
  if (month !== undefined) {
    return calendarInterval(
      start,
      addCalendarMonths(start, 1),
      "month",
      input.timezone,
    );
  }
  return calendarInterval(
    start,
    calendarDate(year + 1, 1, 1),
    "year",
    input.timezone,
  );
}

function resolveExpressionInterval(input: {
  expression: TemporalExpression;
  locale: string;
  reference: CalendarDateTime;
  timezone: string;
}): TemporalInterval | undefined {
  const expression = input.expression;
  if (expression.kind === "range") {
    if (!expression.start || !expression.end ||
      !isRfc3339Instant(expression.start) || !isRfc3339Instant(expression.end)) {
      return undefined;
    }
    const start = new Date(expression.start).toISOString();
    const endExclusive = new Date(expression.end).toISOString();
    return Date.parse(start) < Date.parse(endExclusive)
      ? {
          start,
          endExclusive,
          precision: "instant",
          timezone: input.timezone,
        }
      : undefined;
  }
  if (expression.kind === "absolute") {
    if ("iso" in expression) {
      if (!isRfc3339Instant(expression.iso)) {
        return undefined;
      }
      const start = new Date(expression.iso).toISOString();
      return {
        start,
        endExclusive: new Date(Date.parse(start) + 1).toISOString(),
        precision: "instant",
        timezone: input.timezone,
      };
    }
    return absoluteCalendarInterval({
      calendar: expression.calendar,
      precision: expression.precision,
      timezone: input.timezone,
    });
  }
  return relativeCalendarInterval({
    expression,
    locale: input.locale,
    reference: input.reference,
    timezone: input.timezone,
  });
}

export function resolveTemporalInterval(
  expressions: readonly TemporalExpression[],
  referenceTime: string,
  timezone: string,
  locale: string,
): TemporalInterval | undefined {
  if (!isRfc3339Instant(referenceTime) || !isIanaTimezone(timezone)) {
    return undefined;
  }
  const reference = zonedDateTime(new Date(referenceTime), timezone);
  for (const expression of expressions) {
    const interval = resolveExpressionInterval({
      expression,
      locale,
      reference,
      timezone,
    });
    if (interval) {
      return interval;
    }
  }
  return undefined;
}
