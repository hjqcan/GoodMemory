import { hasPersistableSemanticText } from "../domain/semanticText";
import type { MemoryCandidate } from "./candidates";
import type {
  ClassifiedCandidate,
  RememberEvent,
} from "./contracts";

const SCORE_THRESHOLD = 0.7;

export function toRememberEventMemoryType(
  memoryType: ClassifiedCandidate["memoryType"],
): RememberEvent["memoryType"] {
  return memoryType === "reject" ? "fact" : memoryType;
}

export function buildRememberEventTrace(
  candidate: Pick<
    MemoryCandidate,
    | "explicitness"
    | "annotation"
    | "extractionSources"
    | "extractorIds"
    | "profileId"
    | "presetId"
    | "ruleIds"
  >,
): Pick<
  RememberEvent,
  | "sourceMethod"
  | "annotation"
  | "extractionSources"
  | "extractorIds"
  | "profileId"
  | "presetId"
  | "ruleIds"
> {
  return {
    annotation: candidate.annotation,
    extractorIds: candidate.extractorIds,
    extractionSources: mergeExtractionSources(candidate.extractionSources),
    profileId: candidate.profileId,
    presetId: candidate.presetId,
    ruleIds: candidate.ruleIds,
    sourceMethod: candidate.explicitness,
  };
}

// The score is an ephemeral accept/reject signal against SCORE_THRESHOLD; it is
// NOT persisted onto the stored record. A written fact's `confidence` comes from
// the extractor's candidate (default 1 when unset), so stored confidence must
// not be read as extraction confidence.
function scoreCandidate(candidate: MemoryCandidate): number {
  if (candidate.kindHint === "noise") {
    return 0;
  }

  if (candidate.kindHint === "profile") {
    return candidate.explicitness === "explicit" ? 0.96 : 0.5;
  }

  if (candidate.kindHint === "feedback") {
    return 0.95;
  }

  if (candidate.kindHint === "preference") {
    return 0.9;
  }

  if (candidate.kindHint === "reference") {
    return 0.88;
  }

  if (candidate.kindHint === "fact") {
    return candidate.explicitness === "explicit" ? 0.92 : 0.64;
  }

  return 0.4;
}

function hasValidCandidatePayload(candidate: MemoryCandidate): boolean {
  const hasContent = hasPersistableSemanticText(candidate.content);

  if (candidate.kindHint === "profile") {
    return (
      hasContent &&
      typeof candidate.metadata?.profileField === "string"
    );
  }

  if (candidate.kindHint === "fact" || candidate.kindHint === "feedback") {
    return hasContent;
  }

  if (candidate.kindHint === "preference") {
    return hasContent && hasPersistableSemanticText(
      String(candidate.metadata?.preferenceValue ?? candidate.content),
    );
  }

  if (candidate.kindHint === "reference") {
    return hasContent && hasPersistableSemanticText(
      String(candidate.metadata?.referencePointer ?? candidate.content),
    );
  }

  return true;
}

export function classifyCandidate(candidate: MemoryCandidate): ClassifiedCandidate {
  const score = scoreCandidate(candidate);

  if (candidate.kindHint === "noise") {
    return {
      ...candidate,
      memoryType: "reject",
      decision: "reject",
      score,
      reason: "noise",
    };
  }

  if (
    candidate.kindHint !== "profile" &&
    candidate.kindHint !== "preference" &&
    candidate.kindHint !== "reference" &&
    candidate.kindHint !== "fact" &&
    candidate.kindHint !== "feedback"
  ) {
    return {
      ...candidate,
      memoryType: "reject",
      decision: "reject",
      score,
      reason: "unsupported_kind",
    };
  }

  if (!hasValidCandidatePayload(candidate)) {
    return {
      ...candidate,
      memoryType: "reject",
      decision: "reject",
      score,
      reason: "invalid_payload",
    };
  }

  if (score < SCORE_THRESHOLD && candidate.annotation?.remember !== "always") {
    return {
      ...candidate,
      memoryType: "reject",
      decision: "reject",
      score,
      reason: "below_threshold",
    };
  }

  return {
    ...candidate,
    memoryType: candidate.kindHint,
    decision: "write",
    score,
  };
}

export function mergeExtractionSources(
  ...groups: Array<MemoryCandidate["extractionSources"] | undefined>
): NonNullable<MemoryCandidate["extractionSources"]> {
  const sources = groups.flatMap((group) => group ?? []);

  return sources.length > 0 ? [...new Set(sources)] : ["rules-only"];
}
