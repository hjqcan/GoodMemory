import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  validateC6OriginalRequestSemanticReviewReceipt,
} from "../../../scripts/codex-coding-effect/c6-original-request-semantic-review";
import {
  inspectC6RealHistorySemanticScreeningLedger,
} from "../../../scripts/codex-coding-effect/c6-real-history-semantic-screening";
import {
  parseC6RealHistoryTransitionQualification,
} from "../../../scripts/codex-coding-effect/c6-real-history-transition-qualification";

const SOURCE_ROOT = resolve(
  "fixtures/codex-coding-effect/c6-source-pool",
);
const PROJECTION_PATH = resolve(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.real-history-original-request-projections.json",
);
const QUALIFICATION_PATH = resolve(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.real-history-transition-qualification.json",
);
const RECEIPT_PATH = resolve(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.real-history-original-request-semantic-review.json",
);
const SCREENING_PATH = resolve(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.real-history-semantic-screening.json",
);

test("C6 original-request semantic review gate accepts only the bounded self-attested review receipt", async () => {
  const [
    projectionBytes,
    qualificationBytes,
    receiptBytes,
    screeningBytes,
  ] = await Promise.all([
    readFile(PROJECTION_PATH),
    readFile(QUALIFICATION_PATH),
    readFile(RECEIPT_PATH),
    readFile(SCREENING_PATH),
  ]);
  expect(sha256(receiptBytes)).toBe(
    "d3c274149a1b2f7a5c04ff96fd560b91f424733fb90aa0d3534cf78767584f2d",
  );
  const qualification = parseC6RealHistoryTransitionQualification(
    JSON.parse(qualificationBytes.toString("utf8")) as unknown,
  );
  const semanticState = inspectC6RealHistorySemanticScreeningLedger(
    JSON.parse(screeningBytes.toString("utf8")) as unknown,
  );
  const stage1Candidates = semanticState.continuationAnchorIds.map(
    (anchorId) => {
      const candidate = qualification.candidates.find(
        (entry) => entry.anchorId === anchorId,
      );
      const stage = candidate?.stages[0];
      if (candidate === undefined || stage === undefined) {
        throw new Error(`missing C6 stage-1 candidate: ${anchorId}`);
      }
      return {
        anchorId,
        cappedPoolRank: candidate.cappedPoolRank,
        stage1AfterCommit:
          stage.sourceTransitionLineage.afterCommit,
      };
    },
  );

  expect(validateC6OriginalRequestSemanticReviewReceipt({
    projectionArtifact: JSON.parse(
      projectionBytes.toString("utf8"),
    ) as unknown,
    projectionArtifactSha256: sha256(projectionBytes),
    qualificationSha256: sha256(qualificationBytes),
    receipt: JSON.parse(receiptBytes.toString("utf8")) as unknown,
    stage1Candidates,
  })).toEqual({
    acceptedEpisodeCount: 0,
    candidateManifestFrozen: false,
    codexRunReady: false,
    externalSourceCaptureAuthenticated: false,
    machineQualificationCandidateCount: 0,
    materializedPromptCount: 3,
    reviewCryptographicReceipt: false,
    stage1SemanticReviewPendingCount: 0,
    stage1SemanticReviewedCount: 3,
    stage1TransitionQualificationBound: false,
  });
});

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
