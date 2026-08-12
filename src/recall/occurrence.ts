import type { FactMemory } from "../domain/records";
import type { TemporalInterval } from "../domain/temporal";
import type { TemporalConstraint } from "./recallPlan";

export type OccurrenceMatch = "disjoint" | "matched" | "partial" | "unknown";

export function matchOccurrence(
  occurrence: TemporalInterval | undefined,
  query: TemporalInterval,
): OccurrenceMatch {
  if (!occurrence) {
    return "unknown";
  }
  const occurrenceStart = Date.parse(occurrence.start);
  const occurrenceEnd = Date.parse(occurrence.endExclusive);
  const queryStart = Date.parse(query.start);
  const queryEnd = Date.parse(query.endExclusive);
  if (![occurrenceStart, occurrenceEnd, queryStart, queryEnd].every(Number.isFinite)) {
    return "unknown";
  }
  if (occurrenceEnd <= queryStart || occurrenceStart >= queryEnd) {
    return "disjoint";
  }
  if (occurrenceStart >= queryStart && occurrenceEnd <= queryEnd) {
    return "matched";
  }
  return "partial";
}

export function filterFactsByOccurrence(
  facts: readonly FactMemory[],
  constraints: readonly TemporalConstraint[],
): FactMemory[] {
  const intervals = constraints.flatMap((constraint) =>
    constraint.kind === "during" ? [constraint.interval] : []
  );
  if (intervals.length === 0) {
    return [...facts];
  }
  return facts.filter((fact) =>
    intervals.every((interval) =>
      matchOccurrence(fact.occurrence, interval) === "matched"
    )
  );
}
