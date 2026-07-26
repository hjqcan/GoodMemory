import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  validateC6RealHistorySemanticScreening,
} from "../../../scripts/codex-coding-effect/c6-real-history-semantic-screening";
import {
  parseC6RealHistoryTransitionQualification,
} from "../../../scripts/codex-coding-effect/c6-real-history-transition-qualification";
import type {
  C6ReviewTrajectoryDiscovery,
} from "../../../scripts/codex-coding-effect/c6-review-trajectory-discovery";

const SOURCE_ROOT = resolve(
  "fixtures/codex-coding-effect/c6-source-pool",
);
const QUALIFICATION_PATH = resolve(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.real-history-transition-qualification.json",
);
const SCREENING_PATH = resolve(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.real-history-semantic-screening.json",
);
const TRAJECTORY_PATH = resolve(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.review-trajectory-discovery.json",
);

test("C6 real-history semantic screening gate keeps the assessed rank prefix screening-only and accepted count zero", async () => {
  const [qualificationBytes, screeningBytes, trajectoryBytes] =
    await Promise.all([
      readFile(QUALIFICATION_PATH),
      readFile(SCREENING_PATH),
      readFile(TRAJECTORY_PATH),
  ]);
  expect(sha256(screeningBytes)).toBe(
    "35a5ebc83da5a6ac4c3bc799d6d7484d7fc89e049b5ddb3e8b9ee752c9cc4796",
  );
  const evidence = validateC6RealHistorySemanticScreening({
    ledger: JSON.parse(screeningBytes.toString("utf8")) as unknown,
    qualification: parseC6RealHistoryTransitionQualification(
      JSON.parse(qualificationBytes.toString("utf8")) as unknown,
    ),
    trajectory: JSON.parse(
      trajectoryBytes.toString("utf8"),
    ) as C6ReviewTrajectoryDiscovery,
  });
  expect(evidence).toEqual({
    acceptedEpisodeCount: 0,
    assessedCandidateCount: 42,
    candidateManifestFrozen: false,
    codexRunReady: false,
    laterStageContinuationCount: 5,
    machineQualificationCandidateCount: 0,
    nextUnauditedCappedPoolRank: 43,
    originalRequestProjectionCount: 0,
    rejectedCandidateCount: 37,
    reviewCryptographicReceipt: false,
    semanticScreeningOnly: true,
    stage1AgentVisibleRequestsBound: false,
  });
});

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
