import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  loadC6RealHistoryTransitionEvaluatorScreening,
} from "../../../scripts/codex-coding-effect/c6-real-history-transition-evaluator-screening";
import {
  parseC6RealHistoryTransitionQualification,
} from "../../../scripts/codex-coding-effect/c6-real-history-transition-qualification";
import type {
  C6ReviewTrajectoryDiscovery,
} from "../../../scripts/codex-coding-effect/c6-review-trajectory-discovery";

const SOURCE_ROOT = resolve(
  "fixtures/codex-coding-effect/c6-source-pool",
);
const FIXTURE_ROOT = resolve(
  "fixtures/codex-coding-effect/c6-fmt974-transition-evaluator-screening",
);

test("C6 rank-5 transition-evaluator gate keeps the local Linux rejection fail-closed", async () => {
  const [
    qualificationBytes,
    semanticScreeningBytes,
    trajectoryBytes,
    evidenceBytes,
  ] = await Promise.all([
    readFile(resolve(
      SOURCE_ROOT,
      "multi-swe-full-56ff018.real-history-transition-qualification.json",
    )),
    readFile(resolve(
      SOURCE_ROOT,
      "multi-swe-full-56ff018.real-history-semantic-screening.json",
    )),
    readFile(resolve(
      SOURCE_ROOT,
      "multi-swe-full-56ff018.review-trajectory-discovery.json",
    )),
    readFile(resolve(FIXTURE_ROOT, "evidence.json")),
  ]);
  expect(sha256(evidenceBytes)).toBe(
    "5235b39c9bffd688a62e384edf77c9ae165c7c9d898bb2ea83d821a74e1c12f8",
  );

  const result = await loadC6RealHistoryTransitionEvaluatorScreening({
    fixtureRoot: FIXTURE_ROOT,
    qualification: parseC6RealHistoryTransitionQualification(
      JSON.parse(qualificationBytes.toString("utf8")) as unknown,
    ),
    semanticScreening: JSON.parse(
      semanticScreeningBytes.toString("utf8"),
    ) as unknown,
    trajectory: JSON.parse(
      trajectoryBytes.toString("utf8"),
    ) as C6ReviewTrajectoryDiscovery,
  });

  expect(result.assetLockSha256).toBe(
    "a9455232d26beeec738f647969506e248542dde4a6cb8d7405d270287aedeff0",
  );
  expect(result.assetRootSha256).toBe(
    "8a73c28419fe230e15130068a836d7c1e0043b1144aee94128eea43a5e2e369b",
  );
  expect(result.derived).toMatchObject({
    acceptedEpisodeCount: 0,
    candidateExpansionRequired: true,
    candidateManifestFrozen: false,
    cappedPoolCanMeetMinimum: false,
    codexRunReady: false,
    evaluatedContinuationCount: 1,
    machineQualifiedCount: 0,
    minimumRequiredMachineQualifiedCount: 48,
    rejectedContinuationCount: 1,
  });
  expect(result.assessments[0]).toEqual({
    anchorId: "fmtlib/fmt#974",
    blockingStagePositions: [2, 3],
    cappedPoolRank: 5,
    decision: "reject-machine-qualification",
    qualifiedStagePositions: [1],
    reasonCodes: [
      "STAGE2_PUBLIC_HEADER_COMPILE_FAILURE",
      "STAGE3_THROW_TERMINATES",
    ],
  });
  expect(result.recording).toEqual({
    executionAuthenticated: false,
    persistedValidation:
      "frozen-assets-receipt-and-derived-rejection-only",
    projectionProvesLiveDockerReplay: false,
    rawExecutionLogsRetained: true,
    recordedExecutorAuthority: "local-system-docker",
    sourceRepositoryArchiveRetained: false,
  });
});

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
