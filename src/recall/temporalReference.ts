import type { LanguageTemporalExpression } from "../language";
export { resolveTemporalInterval } from "../domain/temporal";

const DAY_MS = 86_400_000;

function utcInstant(
  year: number,
  month = 1,
  day = 1,
): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return date.toISOString();
}

function utcDayStart(instantMs: number): string {
  const date = new Date(instantMs);
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  )).toISOString();
}

function resolveExpression(
  expression: LanguageTemporalExpression,
  referenceTime: string,
): string | undefined {
  if (expression.kind === "range") {
    return expression.start;
  }
  if (expression.kind === "absolute") {
    if ("iso" in expression) {
      const instant = Date.parse(expression.iso);
      return Number.isFinite(instant) ? new Date(instant).toISOString() : undefined;
    }
    return utcInstant(
      expression.calendar.year,
      expression.calendar.month,
      expression.calendar.day,
    );
  }

  const referenceMs = Date.parse(referenceTime);
  if (!Number.isFinite(referenceMs)) {
    return undefined;
  }
  const reference = new Date(referenceMs);
  if ("occurrence" in expression) {
    let year = reference.getUTCFullYear();
    const currentMonth = reference.getUTCMonth() + 1;
    if (
      expression.occurrence === "strictly_before"
        ? expression.month >= currentMonth
        : expression.month > currentMonth
    ) {
      year -= 1;
    }
    return utcInstant(year, expression.month);
  }
  if (expression.unit === "day" || expression.unit === "week") {
    const days = expression.offset * (expression.unit === "week" ? 7 : 1);
    return utcDayStart(referenceMs + days * DAY_MS);
  }
  if (expression.unit === "month") {
    return new Date(Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth() + expression.offset,
      1,
    )).toISOString();
  }
  if (expression.unit === "quarter") {
    const quarterMonth = Math.floor(reference.getUTCMonth() / 3) * 3;
    return new Date(Date.UTC(
      reference.getUTCFullYear(),
      quarterMonth + expression.offset * 3,
      1,
    )).toISOString();
  }
  return utcInstant(reference.getUTCFullYear() + expression.offset);
}

export function resolveTemporalReference(
  expressions: readonly LanguageTemporalExpression[],
  referenceTime: string,
): string | undefined {
  for (const expression of expressions) {
    const resolved = resolveExpression(expression, referenceTime);
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}
