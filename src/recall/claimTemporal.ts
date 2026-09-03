import type { ClaimProjection } from "./projections/contracts";

export function resolveClaimEventTime(claim: ClaimProjection): string {
  for (const value of [claim.validFrom, claim.observedAt, claim.ingestedAt]) {
    if (value && Number.isFinite(Date.parse(value))) {
      return value;
    }
  }
  return claim.ingestedAt;
}

export function resolveClaimEndTime(
  claim: Pick<ClaimProjection, "validUntil">,
): string | undefined {
  const value = claim.validUntil;
  return value && Number.isFinite(Date.parse(value)) ? value : undefined;
}

export function claimEndTimestamp(
  claim: Pick<ClaimProjection, "validUntil">,
): number | undefined {
  const value = resolveClaimEndTime(claim);
  return value ? Date.parse(value) : undefined;
}

export function claimEventTimestamp(claim: ClaimProjection): number {
  return Date.parse(resolveClaimEventTime(claim));
}

export function compareClaimEventTime(
  left: ClaimProjection,
  right: ClaimProjection,
): number {
  return claimEventTimestamp(left) - claimEventTimestamp(right);
}

export function selectLatestClaimsAtEventTime(
  claims: readonly ClaimProjection[],
): ClaimProjection[] {
  if (claims.length === 0) {
    return [];
  }
  const latestTime = Math.max(...claims.map(claimEventTimestamp));
  return claims.filter((claim) => claimEventTimestamp(claim) === latestTime);
}
