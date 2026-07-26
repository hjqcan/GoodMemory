import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  loadC6RealHistoryTransitionEvaluatorScreening,
  validateC6RealHistoryTransitionEvaluatorScreening,
} from "../../scripts/codex-coding-effect/c6-real-history-transition-evaluator-screening";
import {
  parseC6RealHistoryTransitionQualification,
} from "../../scripts/codex-coding-effect/c6-real-history-transition-qualification";
import type {
  C6ReviewTrajectoryDiscovery,
} from "../../scripts/codex-coding-effect/c6-review-trajectory-discovery";

const SOURCE_ROOT = resolve(
  "fixtures/codex-coding-effect/c6-source-pool",
);
const FIXTURE_ROOT = resolve(
  "fixtures/codex-coding-effect/c6-fmt974-transition-evaluator-screening",
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

describe("C6 real-history transition-evaluator screening", () => {
  it("derives the rank-5 machine rejection without promoting an episode", async () => {
    const inputs = await trackedInputs();
    const result = await loadC6RealHistoryTransitionEvaluatorScreening({
      fixtureRoot: FIXTURE_ROOT,
      ...inputs,
    });

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
    expect(result.assessments).toEqual([
      {
        anchorId: "fmtlib/fmt#974",
        cappedPoolRank: 5,
        decision: "reject-machine-qualification",
        qualifiedStagePositions: [1],
        blockingStagePositions: [2, 3],
        reasonCodes: [
          "STAGE2_PUBLIC_HEADER_COMPILE_FAILURE",
          "STAGE3_THROW_TERMINATES",
        ],
      },
    ]);
    expect(result.recording).toMatchObject({
      executionAuthenticated: false,
      persistedValidation:
        "frozen-assets-receipt-and-derived-rejection-only",
      projectionProvesLiveDockerReplay: false,
      rawExecutionLogsRetained: true,
    });
  });

  it("rejects semantic drift, skipped continuations, source drift, and fabricated decisions", async () => {
    const inputs = await trackedInputs();
    const loaded = await loadC6RealHistoryTransitionEvaluatorScreening({
      fixtureRoot: FIXTURE_ROOT,
      ...inputs,
    });
    const mutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => {
        const semanticScreening = value.semanticScreening as Record<
          string,
          unknown
        >;
        semanticScreening.assessmentPrefixSha256 = "a".repeat(64);
      },
      (value) => {
        const assessments = value.assessments as Array<Record<string, unknown>>;
        assessments.pop();
      },
      (value) => {
        const assessment = firstAssessment(value);
        assessment.semanticAssessmentSha256 = "b".repeat(64);
      },
      (value) => {
        const assessment = firstAssessment(value);
        const stages = assessment.stages as Array<Record<string, unknown>>;
        const after = stages[1]!.after as Record<string, unknown>;
        after.commitSha = "c".repeat(40);
      },
      (value) => {
        const assessment = firstAssessment(value);
        const stages = assessment.stages as Array<Record<string, unknown>>;
        const evaluator = stages[0]!.evaluator as Record<string, unknown>;
        evaluator.sha256 = "d".repeat(64);
      },
      (value) => {
        const assessment = firstAssessment(value);
        const stages = assessment.stages as Array<Record<string, unknown>>;
        const before = stages[0]!.before as Record<string, unknown>;
        const observation = before.observation as Record<string, unknown>;
        observation.exitCode = 0;
      },
      (value) => {
        const assessment = firstAssessment(value);
        const stages = assessment.stages as Array<Record<string, unknown>>;
        const after = stages[0]!.after as Record<string, unknown>;
        const observation = after.observation as Record<string, unknown>;
        observation.phase = "compile";
      },
      (value) => {
        const assessment = firstAssessment(value);
        const benchmarkBase = assessment.benchmarkBase as Record<
          string,
          unknown
        >;
        benchmarkBase.commitSha = "e".repeat(40);
      },
      (value) => {
        const assessment = firstAssessment(value);
        const stages = assessment.stages as Array<Record<string, unknown>>;
        const after = stages[0]!.after as Record<string, unknown>;
        after.treeSha = "f".repeat(40);
      },
      (value) => {
        const profile = value.dockerProfile as Record<string, unknown>;
        profile.image =
          "mswebench/fmtlib_m_fmt@sha256:" + "1".repeat(64);
      },
      (value) => {
        const assessment = firstAssessment(value);
        const license = assessment.historicalLicense as Record<
          string,
          unknown
        >;
        license.licenseSha256 = "2".repeat(64);
      },
      (value) => {
        firstAssessment(value).decision = "machine-qualified";
      },
      (value) => {
        firstAssessment(value).reasonCodes = [
          "STAGE2_PUBLIC_HEADER_COMPILE_FAILURE",
        ];
      },
    ];

    for (const mutate of mutations) {
      const evidence = structuredClone(
        loaded.evidence,
      ) as unknown as Record<string, unknown>;
      mutate(evidence);
      expect(() => validateC6RealHistoryTransitionEvaluatorScreening({
        assetContents: loaded.assetContents,
        assetFiles: loaded.assetFiles,
        evidence,
        ...inputs,
      })).toThrow();
    }
  });

  it("derives concrete failure classes from retained diagnostic logs", async () => {
    const inputs = await trackedInputs();
    const loaded = await loadC6RealHistoryTransitionEvaluatorScreening({
      fixtureRoot: FIXTURE_ROOT,
      ...inputs,
    });
    for (const mutation of [
      {
        path: "results/stage2-after-e636.log",
        stageIndex: 1,
      },
      {
        path: "results/stage3-after-2efa-or.log",
        stageIndex: 2,
      },
    ]) {
      const evidence = structuredClone(loaded.evidence);
      const assetContents = { ...loaded.assetContents };
      const assetFiles = loaded.assetFiles.map((file) => ({ ...file }));
      const replacement = "unrelated_failure=true\nexit_code=1\n";
      const replacementSha256 = createHash("sha256")
        .update(replacement)
        .digest("hex");
      assetContents[mutation.path] = replacement;
      const assetFile = assetFiles.find((file) =>
        file.path === mutation.path
      )!;
      assetFile.sha256 = replacementSha256;
      assetFile.bytes = Buffer.byteLength(replacement);
      evidence.assessments[0]!.stages[
        mutation.stageIndex
      ]!.after.observation.log.sha256 = replacementSha256;

      expect(() => validateC6RealHistoryTransitionEvaluatorScreening({
        assetContents,
        assetFiles,
        evidence,
        ...inputs,
      })).toThrow();
    }
  });

  it("recomputes Git commit IDs and tree mappings from retained objects", async () => {
    const inputs = await trackedInputs();
    const loaded = await loadC6RealHistoryTransitionEvaluatorScreening({
      fixtureRoot: FIXTURE_ROOT,
      ...inputs,
    });
    const evidence = structuredClone(loaded.evidence);
    const assetContents = { ...loaded.assetContents };
    const assetFiles = loaded.assetFiles.map((file) => ({ ...file }));
    const object = evidence.assessments[0]!.gitCommitObjects[0]!;
    const original = assetContents[object.path]!;
    const replacement = `${original[0] === "a" ? "b" : "a"}${original.slice(1)}`;
    const replacementSha256 = createHash("sha256")
      .update(replacement)
      .digest("hex");
    assetContents[object.path] = replacement;
    object.sha256 = replacementSha256;
    const assetFile = assetFiles.find((file) =>
      file.path === object.path
    )!;
    assetFile.sha256 = replacementSha256;
    assetFile.bytes = Buffer.byteLength(replacement);

    expect(() => validateC6RealHistoryTransitionEvaluatorScreening({
      assetContents,
      assetFiles,
      evidence,
      ...inputs,
    })).toThrow("commit object does not match");
  });
});

async function trackedInputs() {
  const [qualificationBytes, semanticScreeningBytes, trajectoryBytes] =
    await Promise.all([
      readFile(QUALIFICATION_PATH),
      readFile(SCREENING_PATH),
      readFile(TRAJECTORY_PATH),
    ]);
  return {
    qualification: parseC6RealHistoryTransitionQualification(
      JSON.parse(qualificationBytes.toString("utf8")) as unknown,
    ),
    semanticScreening: JSON.parse(
      semanticScreeningBytes.toString("utf8"),
    ) as unknown,
    trajectory: JSON.parse(
      trajectoryBytes.toString("utf8"),
    ) as C6ReviewTrajectoryDiscovery,
  };
}

function firstAssessment(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const assessments = value.assessments as Array<Record<string, unknown>>;
  return assessments[0]!;
}
