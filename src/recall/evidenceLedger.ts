import type { EvidenceRecord } from "../evidence/contracts";
import type { ClaimProjection } from "./projections/contracts";
import type { RecallAggregation } from "./recallPlan";

export interface EvidenceLedgerEntry {
  evidenceId: string;
  sourceMemoryId: string;
  actor?: string;
  excerpt: string;
  claim?: ClaimProjection;
  temporalStatus: "current" | "superseded" | "uncertain";
  relation: "supports" | "contradicts" | "context";
}

export interface BuildEvidenceLedgerInput {
  aggregation?: RecallAggregation;
  ambiguousSourceMemoryIds?: readonly string[];
  claims: readonly ClaimProjection[];
  evidence: readonly EvidenceRecord[];
  referenceTime: string;
  selectedMemoryIds: readonly string[];
}

function groupKey(claim: ClaimProjection): string {
  return [claim.scopeKey, claim.subjectEntityId, claim.predicateKey].join("\u0000");
}

function claimTimestamp(claim: ClaimProjection): number {
  return Date.parse(claim.validFrom ?? claim.observedAt ?? claim.ingestedAt);
}

function isFuture(claim: ClaimProjection, reference: number): boolean {
  const timestamp = Date.parse(claim.validFrom ?? claim.observedAt);
  return Number.isFinite(timestamp) && timestamp > reference;
}

function isExpired(claim: ClaimProjection, reference: number): boolean {
  if (!claim.validUntil) {
    return false;
  }
  const timestamp = Date.parse(claim.validUntil);
  return Number.isFinite(timestamp) && timestamp <= reference;
}

function resolveTemporalStatus(input: {
  aggregation?: RecallAggregation;
  claims: readonly ClaimProjection[];
  referenceTime: string;
}): Map<string, EvidenceLedgerEntry["temporalStatus"]> {
  const reference = Date.parse(input.referenceTime);
  const statuses = new Map<
    string,
    EvidenceLedgerEntry["temporalStatus"]
  >();
  const grouped = new Map<string, ClaimProjection[]>();
  for (const claim of input.claims) {
    const key = groupKey(claim);
    grouped.set(key, [...(grouped.get(key) ?? []), claim]);
  }

  for (const claims of grouped.values()) {
    const active = claims
      .filter((claim) => !isFuture(claim, reference) && !isExpired(claim, reference))
      .sort(
        (left, right) =>
          claimTimestamp(left) - claimTimestamp(right) ||
          left.id.localeCompare(right.id),
      );
    const currentIds = input.aggregation === "count"
      ? new Set(active.map(({ id }) => id))
      : new Set(active.at(-1) ? [active.at(-1)!.id] : []);

    for (const claim of claims) {
      statuses.set(
        claim.id,
        isFuture(claim, reference)
          ? "uncertain"
          : currentIds.has(claim.id)
            ? "current"
            : "superseded",
      );
    }
  }
  return statuses;
}

function claimValue(claim: ClaimProjection): string {
  return [claim.polarity, claim.modality, claim.objectText].join("\u0000");
}

function resolveRelation(input: {
  claim: ClaimProjection;
  claims: readonly ClaimProjection[];
  status: EvidenceLedgerEntry["temporalStatus"];
  statuses: ReadonlyMap<string, EvidenceLedgerEntry["temporalStatus"]>;
}): EvidenceLedgerEntry["relation"] {
  if (input.status === "current") {
    return "supports";
  }
  if (input.status === "uncertain") {
    return "context";
  }
  const current = input.claims.find(
    (claim) =>
      groupKey(claim) === groupKey(input.claim) &&
      input.statuses.get(claim.id) === "current",
  );
  return current && claimValue(current) !== claimValue(input.claim)
    ? "contradicts"
    : "context";
}

function evidenceActor(evidence: EvidenceRecord): string | undefined {
  for (const key of ["actor", "speaker", "sourceRole"]) {
    const value = evidence.attributes?.[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

export function buildEvidenceLedger(
  input: BuildEvidenceLedgerInput,
): EvidenceLedgerEntry[] {
  const selected = new Set(input.selectedMemoryIds);
  const ambiguous = new Set(input.ambiguousSourceMemoryIds ?? []);
  const selectedClaims = input.claims.filter((claim) =>
    selected.has(claim.sourceMemoryId),
  );
  const statuses = resolveTemporalStatus({
    aggregation: input.aggregation,
    claims: input.claims,
    referenceTime: input.referenceTime,
  });
  const claimsByMemory = new Map<string, ClaimProjection[]>();
  for (const claim of selectedClaims) {
    claimsByMemory.set(claim.sourceMemoryId, [
      ...(claimsByMemory.get(claim.sourceMemoryId) ?? []),
      claim,
    ]);
  }

  const entries: EvidenceLedgerEntry[] = [];
  for (const sourceMemoryId of selected) {
    const linkedEvidence = input.evidence.filter(
      (record) =>
        record.linkedMemoryIds.includes(sourceMemoryId) ||
        record.linkedArchiveIds.includes(sourceMemoryId),
    );
    for (const evidence of linkedEvidence) {
      const sourceClaims = claimsByMemory.get(sourceMemoryId) ?? [];
      const linkedClaims = sourceClaims.filter((claim) =>
        claim.evidenceIds.includes(evidence.id),
      );
      const hasExplicitEvidenceLinks = sourceClaims.some(
        (claim) => claim.evidenceIds.length > 0,
      );
      const evidenceClaims = linkedClaims.length > 0
        ? linkedClaims
        : ambiguous.has(sourceMemoryId) || hasExplicitEvidenceLinks
          ? []
          : sourceClaims;
      const actor = evidenceActor(evidence);
      if (evidenceClaims.length === 0) {
        entries.push({
          evidenceId: evidence.id,
          sourceMemoryId,
          ...(actor ? { actor } : {}),
          excerpt: evidence.excerpt,
          temporalStatus: "uncertain",
          relation: "context",
        });
        continue;
      }
      for (const claim of evidenceClaims) {
        const temporalStatus = statuses.get(claim.id) ?? "uncertain";
        entries.push({
          evidenceId: evidence.id,
          sourceMemoryId,
          ...(actor ? { actor } : {}),
          excerpt: evidence.excerpt,
          claim,
          temporalStatus,
          relation: resolveRelation({
            claim,
            claims: input.claims,
            status: temporalStatus,
            statuses,
          }),
        });
      }
    }
  }
  return entries;
}
