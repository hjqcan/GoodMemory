import { extractReferencePointer } from "../domain/referencePointer";
import {
  durableOptOutTargetIdentities,
  normalizeDurableTargetValue,
  sameDurableTargetIdentity,
} from "../domain/memoryCandidate";
import type { FeedbackKind } from "../domain/records";
import type {
  DurableOptOutTargetSelector,
  MemoryCandidate,
} from "./candidates";

function exactTargetValues(value: string): string[] {
  const values = new Set([value]);
  const pointer = extractReferencePointer(value);
  if (pointer) {
    values.add(pointer);
  }
  return [...values]
    .map(normalizeDurableTargetValue)
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
    const candidateIdentity = candidate.durableTarget;
    const identities = durableOptOutTargetIdentities(selector);
    if (candidateIdentity && identities.length > 0) {
      return identities.some((identity) =>
        sameDurableTargetIdentity(identity, candidateIdentity)
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
