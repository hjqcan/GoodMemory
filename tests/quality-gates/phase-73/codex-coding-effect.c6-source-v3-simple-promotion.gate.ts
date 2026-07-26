import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  requireC6SourceV3SimpleCensusAuthorization,
} from "../../../scripts/codex-coding-effect/c6-source-v3-simple-census";
import {
  parseC6SourceV3SimplePromotionReceipt,
  verifyC6SourceV3SimplePromotionReceipt,
} from "../../../scripts/codex-coding-effect/c6-source-v3-simple-promotion";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const RECEIPT_PATH = resolve(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool/provenance/" +
    "source-v3-simple/promotion/promotion-receipt-v1.json",
);
const FREEZE_COMMIT_SHA =
  "ba4cee1e668adff0354b23dd743ae44e23e42af9";
const CENSUS_IMPLEMENTATION_COMMIT_SHA =
  "cc42f0bbd673b6595a6c82b3c5cb995a8efbe826";
const RECEIPT_SHA256 =
  "a0892b9c87cce89b23604a43b02d06ad1344fe010afd4894a5f6c387c7d43e3b";

describe("Phase 73 C6 source-v3-simple promotion gate", () => {
  it("rebuilds the committed freeze-to-activation authority without widening it", async () => {
    const receiptBytes = await readFile(RECEIPT_PATH);
    expect(sha256(receiptBytes)).toBe(RECEIPT_SHA256);
    const receipt = parseC6SourceV3SimplePromotionReceipt(
      receiptBytes,
    );
    const promotionInput = {
      censusImplementationCommitSha:
        CENSUS_IMPLEMENTATION_COMMIT_SHA,
      freezeCommitSha: FREEZE_COMMIT_SHA,
      promotionBaseCommitSha:
        CENSUS_IMPLEMENTATION_COMMIT_SHA,
      repositoryRoot: REPOSITORY_ROOT,
    };
    expect(receipt).toMatchObject({
      boundary: {
        candidateManifestFrozen: false,
        candidateSelectionPermitted: false,
        codexRunReady: false,
        formalCensusPermitted: true,
        priorRepositoryNodeIdExclusionComplete: true,
        sourceV3SimpleFrozen: true,
      },
      censusImplementation: {
        commitSha: CENSUS_IMPLEMENTATION_COMMIT_SHA,
      },
      freeze: {
        commitSha: FREEZE_COMMIT_SHA,
      },
      promotionBase: {
        commitSha: CENSUS_IMPLEMENTATION_COMMIT_SHA,
      },
    });
    expect(
      await verifyC6SourceV3SimplePromotionReceipt(
        receiptBytes,
        promotionInput,
      ),
    ).toEqual(receipt);
    expect(
      await requireC6SourceV3SimpleCensusAuthorization({
        promotionInput,
        promotionReceiptBytes: receiptBytes,
      }),
    ).toEqual({
      candidateManifestFrozen: false,
      candidateSelectionPermitted: false,
      codexRunReady: false,
      evaluationId:
        "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
      formalCensusPermitted: true,
      priorRepositoryNodeIdExclusionComplete: true,
      sourceV3SimpleFrozen: true,
    });
  }, 30_000);
});

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
