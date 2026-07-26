import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  validateC6RealHistoryOriginalRequestProjectionArtifact,
} from "../../../scripts/codex-coding-effect/c6-real-history-original-request-projection";
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
const SCREENING_PATH = resolve(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.real-history-semantic-screening.json",
);

test("C6 original-request projection gate binds exact clean prompt bytes without promoting candidates", async () => {
  const [projectionBytes, qualificationBytes, screeningBytes] =
    await Promise.all([
      readFile(PROJECTION_PATH),
      readFile(QUALIFICATION_PATH),
      readFile(SCREENING_PATH),
  ]);
  expect(sha256(projectionBytes)).toBe(
    "b5babf8bab47c2005b20a0dba731252fc3cbb1f9612216152f7e0e13cdd4692d",
  );
  const qualification = parseC6RealHistoryTransitionQualification(
    JSON.parse(qualificationBytes.toString("utf8")) as unknown,
  );
  const semanticState = inspectC6RealHistorySemanticScreeningLedger(
    JSON.parse(screeningBytes.toString("utf8")) as unknown,
  );
  const continuationCandidates = semanticState.continuationAnchorIds.map(
    (anchorId) => {
      const candidate = qualification.candidates.find(
        (entry) => entry.anchorId === anchorId,
      );
      if (candidate === undefined) {
        throw new Error(`missing C6 continuation candidate: ${anchorId}`);
      }
      return candidate;
    },
  );
  const artifact = JSON.parse(
    projectionBytes.toString("utf8"),
  ) as {
    projections: Array<{
      anchorId: string;
      originalRequest: { bytes: number; sha256: string };
    }>;
    recording: {
      exactSourceFilesRequiredForReplay: boolean;
      externalSourceCaptureAuthenticated: boolean;
      independentReviewComplete: boolean;
    };
  };

  expect(validateC6RealHistoryOriginalRequestProjectionArtifact({
    artifact,
    continuationCandidates,
  })).toEqual({
    acceptedEpisodeCount: 0,
    candidateManifestFrozen: false,
    codexRunReady: false,
    machineQualificationCandidateCount: 0,
    materializedPromptCount: 3,
    promptDerivationVerified: true,
    stage1SemanticReviewPendingCount: 3,
    upstreamSourceAuthenticated: false,
  });
  expect(artifact.projections.map((projection) => ({
    anchorId: projection.anchorId,
    bytes: projection.originalRequest.bytes,
    sha256: projection.originalRequest.sha256,
  }))).toEqual([
    {
      anchorId: "fmtlib/fmt#974",
      bytes: 581,
      sha256:
        "b634ea04d647a8a4fbc47673633981fcf9cd279f948469a12bcc39268c918984",
    },
    {
      anchorId: "vuejs/core#9213",
      bytes: 1107,
      sha256:
        "ff36fc0b8c8477d51d0236677d457083e13879933d3b843fd23a6c7d9a830b93",
    },
    {
      anchorId: "clap-rs/clap#2796",
      bytes: 1521,
      sha256:
        "7981a33ddbc754245c75ffd32f1e63033eac8ea964912b84e29d360348bbd123",
    },
  ]);
  expect(artifact.recording).toEqual({
    exactSourceFilesRequiredForReplay: true,
    externalSourceCaptureAuthenticated: false,
    independentReviewComplete: false,
  });
});

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
