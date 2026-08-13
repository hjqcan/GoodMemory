import { extractReferencePointer } from "../domain/referencePointer";
import type { FeedbackKind } from "../domain/records";
import type {
  DurableOptOutTargetSelector,
  DurableTargetIdentity,
  MemoryCandidate,
} from "./candidates";

function normalizeDurableTarget(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function exactTargetValues(value: string): string[] {
  const values = new Set([value]);
  const pointer = extractReferencePointer(value);
  if (pointer) {
    values.add(pointer);
  }
  return [...values]
    .map(normalizeDurableTarget)
    .filter((target) => target.length > 0);
}

function candidateTargetValues(candidate: MemoryCandidate): string[] {
  if (!isDurableTargetCandidate(candidate)) {
    return [];
  }

  const values = new Set([candidate.content]);
  if (candidate.kindHint === "preference") {
    values.add(String(candidate.metadata?.preferenceValue ?? ""));
  }
  if (candidate.kindHint === "reference") {
    values.add(String(candidate.metadata?.referencePointer ?? ""));
  }
  return [...values]
    .flatMap(exactTargetValues)
    .filter((target) => target.length > 0);
}

function sameDurableTargetIdentity(
  left: DurableTargetIdentity,
  right: DurableTargetIdentity,
): boolean {
  return normalizeDurableTarget(left.slot) === normalizeDurableTarget(right.slot) &&
    normalizeDurableTarget(left.value) === normalizeDurableTarget(right.value);
}

export function isDurableOptOutCandidate(
  candidate: MemoryCandidate,
): boolean {
  return candidate.kindHint === "feedback" &&
    candidate.disposition?.kind === "durable_opt_out";
}

export function isDurableTargetCandidate(
  candidate: MemoryCandidate,
): boolean {
  return candidate.kindHint === "fact" ||
    candidate.kindHint === "preference" ||
    candidate.kindHint === "profile" ||
    candidate.kindHint === "reference";
}

export function isTargetedByDurableOptOut(
  candidate: MemoryCandidate,
  selectors: readonly DurableOptOutTargetSelector[],
): boolean {
  if (!isDurableTargetCandidate(candidate)) {
    return false;
  }
  const candidateValues = new Set(candidateTargetValues(candidate));
  return selectors.some((selector) => {
    if (selector.identity && candidate.durableTarget) {
      return sameDurableTargetIdentity(
        selector.identity,
        candidate.durableTarget,
      );
    }
    return exactTargetValues(selector.text).some((target) =>
      candidateValues.has(target)
    );
  });
}

export function resolveFeedbackKind(candidate: MemoryCandidate): FeedbackKind {
  return candidate.disposition?.kind === "durable_opt_out"
    ? "dont"
    : candidate.metadata?.feedbackKind ?? "do";
}
