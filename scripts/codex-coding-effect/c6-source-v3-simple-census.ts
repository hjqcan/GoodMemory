import {
  type C6SourceV3SimplePromotionInput,
  verifyC6SourceV3SimplePromotionReceipt,
} from "./c6-source-v3-simple-promotion";

export const C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_VERSION = 1 as const;

export interface C6SourceV3SimpleCensusAuthorizationInput {
  promotionInput: C6SourceV3SimplePromotionInput;
  promotionReceiptBytes: string | Uint8Array;
}

export async function requireC6SourceV3SimpleCensusAuthorization(
  input: C6SourceV3SimpleCensusAuthorizationInput,
) {
  const receipt = await verifyC6SourceV3SimplePromotionReceipt(
    input.promotionReceiptBytes,
    input.promotionInput,
  );
  return {
    candidateManifestFrozen:
      receipt.boundary.candidateManifestFrozen,
    candidateSelectionPermitted:
      receipt.boundary.candidateSelectionPermitted,
    codexRunReady: receipt.boundary.codexRunReady,
    evaluationId: receipt.evaluationId,
    formalCensusPermitted:
      receipt.boundary.formalCensusPermitted,
    priorRepositoryNodeIdExclusionComplete:
      receipt.boundary.priorRepositoryNodeIdExclusionComplete,
    sourceV3SimpleFrozen:
      receipt.boundary.sourceV3SimpleFrozen,
  } as const;
}
