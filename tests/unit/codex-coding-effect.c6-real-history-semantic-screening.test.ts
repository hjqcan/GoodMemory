import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  parseC6RealHistoryTransitionQualification,
} from "../../scripts/codex-coding-effect/c6-real-history-transition-qualification";
import type {
  C6ReviewTrajectoryDiscovery,
} from "../../scripts/codex-coding-effect/c6-review-trajectory-discovery";
import {
  inspectC6RealHistorySemanticScreeningLedger,
  listC6RealHistorySemanticRejectedAnchorIds,
  validateC6RealHistorySemanticScreening,
} from "../../scripts/codex-coding-effect/c6-real-history-semantic-screening";

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

describe("C6 real-history semantic screening", () => {
  it("records a rank-prefix gold-blind rejection without promoting an episode", async () => {
    const { qualification, trajectory } = await trackedInputs();
    const ledger = JSON.parse(
      await readFile(SCREENING_PATH, "utf8"),
    ) as unknown;
    const result = validateC6RealHistorySemanticScreening({
      ledger,
      qualification,
      trajectory,
    });

    expect(result).toEqual({
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
    expect(listC6RealHistorySemanticRejectedAnchorIds(ledger)).toEqual([
      "fmtlib/fmt#2940",
      "mui/material-ui#37850",
      "cli/cli#549",
      "sveltejs/svelte#13437",
      "tokio-rs/bytes#547",
      "ponylang/ponyc#4505",
      "mui/material-ui#31172",
      "mui/material-ui#38169",
      "mui/material-ui#37667",
      "cli/cli#7288",
      "cli/cli#9113",
      "simdjson/simdjson#1667",
      "sveltejs/svelte#12560",
      "cli/cli#9083",
      "sveltejs/svelte#13850",
      "anuraghazra/github-readme-stats#2099",
      "sveltejs/svelte#12413",
      "google/gson#1787",
      "vuejs/core#10416",
      "tokio-rs/tokio#6618",
      "tokio-rs/tokio#6409",
      "detekt/detekt#7635",
      "facebook/zstd#1726",
      "vuejs/core#8470",
      "vuejs/core#10522",
      "fasterxml/jackson-databind#3851",
      "fmtlib/fmt#3863",
      "ponylang/ponyc#3819",
      "ponylang/ponyc#3675",
      "simdjson/simdjson#1695",
      "ponylang/ponyc#4299",
      "simdjson/simdjson#1615",
      "tokio-rs/tokio#6345",
      "Hannah-Sten/TeXiFy-IDEA#3128",
      "tokio-rs/tracing#1983",
      "elastic/logstash#14058",
      "elastic/logstash#13880",
    ]);
    expect(inspectC6RealHistorySemanticScreeningLedger(ledger)).toMatchObject({
      assessedCandidateCount: 42,
      continuationAnchorIds: [
        "fmtlib/fmt#974",
        "vuejs/core#9213",
        "clap-rs/clap#2796",
        "fmtlib/fmt#2310",
        "tokio-rs/tokio#5343",
      ],
      nextUnauditedCappedPoolRank: 43,
      rejectedCandidateCount: 37,
    });
  });

  it("rejects skipped ranks and candidate, source-request, or transition drift", async () => {
    const { qualification, trajectory } = await trackedInputs();
    const mutations: Array<(value: ReturnType<typeof validLedger>) => void> = [
      (value) => {
        value.assessments[0]!.cappedPoolRank = 2;
      },
      (value) => {
        value.assessments[0]!.anchorId = "mui/material-ui#37850";
      },
      (value) => {
        value.assessments[0]!.stages[1]!.targetSha256 = "a".repeat(64);
      },
      (value) => {
        value.assessments[0]!.stages[2]!.beforeCommit = "b".repeat(40);
      },
    ];

    for (const mutate of mutations) {
      const ledger = validLedger();
      mutate(ledger);
      refreshAssessmentSha(ledger.assessments[0]!);
      expect(() => validateC6RealHistorySemanticScreening({
        ledger,
        qualification,
        trajectory,
      })).toThrow();
    }
  });

  it("requires concrete blocking stages for rejection and forbids outcome access", async () => {
    const { qualification, trajectory } = await trackedInputs();
    const noBlockers = validLedger();
    for (const stage of noBlockers.assessments[0]!.stages) {
      stage.classification = "behavioral-coding-request";
    }
    noBlockers.assessments[0]!.blockingStagePositions = [];
    refreshAssessmentSha(noBlockers.assessments[0]!);
    expect(() => validateC6RealHistorySemanticScreening({
      ledger: noBlockers,
      qualification,
      trajectory,
    })).toThrow("rejection requires at least one semantic blocker");

    const outcomeAccess = validLedger();
    outcomeAccess.assessments[0]!.review.outcomeAccess = true as false;
    expect(() => validateC6RealHistorySemanticScreening({
      ledger: outcomeAccess,
      qualification,
      trajectory,
    })).toThrow();

    const authorCollision = validLedger();
    authorCollision.assessments[0]!.review.reviewerAgentName = "/root";
    expect(() => validateC6RealHistorySemanticScreening({
      ledger: authorCollision,
      qualification,
      trajectory,
    })).toThrow("reviewer 1 is not independent");

    const assessmentDrift = validLedger();
    assessmentDrift.assessments[0]!.finding = "drifted finding";
    expect(() => validateC6RealHistorySemanticScreening({
      ledger: assessmentDrift,
      qualification,
      trajectory,
    })).toThrow("assessment 1 hash does not match");

    const unboundTransitionMismatch = validLedger();
    unboundTransitionMismatch.assessments[0]!.stages[0]!.classification =
      "behavioral-request-transition-mismatch";
    unboundTransitionMismatch.assessments[0]!.blockingStagePositions = [1, 3];
    refreshAssessmentSha(unboundTransitionMismatch.assessments[0]!);
    expect(() => validateC6RealHistorySemanticScreening({
      ledger: unboundTransitionMismatch,
      qualification,
      trajectory,
    })).toThrow(
      "cannot classify an unbound stage-1 transition as mismatched",
    );
  });

  it("binds an independent review receipt to each assessed rank", async () => {
    const { qualification, trajectory } = await trackedInputs();
    const ledger = validLedger();
    ledger.assessments.push(rankTwoAssessment());

    expect(validateC6RealHistorySemanticScreening({
      ledger,
      qualification,
      trajectory,
    })).toEqual({
      acceptedEpisodeCount: 0,
      assessedCandidateCount: 2,
      candidateManifestFrozen: false,
      codexRunReady: false,
      laterStageContinuationCount: 0,
      machineQualificationCandidateCount: 0,
      nextUnauditedCappedPoolRank: 3,
      originalRequestProjectionCount: 0,
      rejectedCandidateCount: 2,
      reviewCryptographicReceipt: false,
      semanticScreeningOnly: true,
      stage1AgentVisibleRequestsBound: false,
    });
    expect(ledger.assessments[0]!.review.reviewerAgentName).not.toBe(
      ledger.assessments[1]!.review.reviewerAgentName,
    );
  });

  it("records the actual bounded parent-context policy without rewriting it as no fork", async () => {
    const { qualification, trajectory } = await trackedInputs();
    const ledger = validLedger();
    ledger.assessments[0]!.review.contextPolicy =
      "fork-turns-3" as "fork-turns-none";
    refreshAssessmentSha(ledger.assessments[0]!);

    expect(() => validateC6RealHistorySemanticScreening({
      ledger,
      qualification,
      trajectory,
    })).not.toThrow();
  });

  it("fails closed while exact stage-1 prompt projections are not materialized", async () => {
    const { qualification, trajectory } = await trackedInputs();
    const ledger = validLedger();
    ledger.originalRequestConstruction.agentVisiblePromptProjectionCount =
      1 as 0;

    expect(() => validateC6RealHistorySemanticScreening({
      ledger,
      qualification,
      trajectory,
    })).toThrow();
  });
});

async function trackedInputs(): Promise<{
  qualification: ReturnType<
    typeof parseC6RealHistoryTransitionQualification
  >;
  trajectory: C6ReviewTrajectoryDiscovery;
}> {
  const [qualificationBytes, trajectoryBytes] = await Promise.all([
    readFile(QUALIFICATION_PATH, "utf8"),
    readFile(TRAJECTORY_PATH, "utf8"),
  ]);
  return {
    qualification: parseC6RealHistoryTransitionQualification(
      JSON.parse(qualificationBytes) as unknown,
    ),
    trajectory: JSON.parse(trajectoryBytes) as C6ReviewTrajectoryDiscovery,
  };
}

function validLedger() {
  const ledger = {
    artifactKind: "c6-real-history-semantic-screening-ledger",
    assessments: [
      {
        anchorId: "fmtlib/fmt#2940",
        blockingStagePositions: [3],
        cappedPoolRank: 1,
        decisionReason: "semantic-dependency-rejected",
        finding:
          "The third review round is style-only and does not form an executable coding transition.",
        screeningDecision: "reject",
        stages: [
          {
            afterCommit: "88bdd35b2ec2e9e77bda9a2b7982b0bd1df85603",
            beforeCommit: null,
            classification: "behavioral-coding-request",
            finding: "The original pull request asks for observable tuple formattability behavior.",
            position: 1,
            targetKind: "source-row",
            targetSha256:
              "272b3c9c408a031c972a1d257c3320f461179bd2d68bf7d7153691d0a3f554a5",
          },
          {
            afterCommit: "d6b0075742735940144e8367403bc0ffd7a9a4a6",
            beforeCommit: "88bdd35b2ec2e9e77bda9a2b7982b0bd1df85603",
            classification: "behavioral-coding-request",
            finding:
              "The review round identifies missing Char propagation and a reproducible wide-character regression.",
            position: 2,
            targetKind: "review-comment",
            targetSha256:
              "f71a8b296a550bc8fb542173defd1cd86a5469d489f643b7592072a17d2d4a0a",
          },
          {
            afterCommit: "1ea1738c22225854309b07c6912b1ad3357ed977",
            beforeCommit: "907a07cbae7ca434deed1a3b602ca1338bb85dc1",
            classification: "non-behavioral-style-only",
            finding:
              "The selected request asks to reuse an existing test type and has no runtime behavior target.",
            position: 3,
            targetKind: "review-comment",
            targetSha256:
              "22c5f7a33306e62490ff6a2d9102ed460af13fd440c0734c8d4986df6dc9b451",
          },
        ],
        review: {
          assessmentSha256: "",
          authorTaskName: "/root",
          contextPolicy: "fork-turns-none",
          cryptographicReceipt: false,
          hiddenEvaluatorAccess: false,
          outcomeAccess: false,
          rawGoldAccess: false,
          reviewedAt: "2026-07-25T19:00:00.000Z",
          reviewerAgentName: "/root/c6_rank1_fmt_gold_blind_review",
        },
      },
    ],
    originalRequestConstruction: {
      agentVisiblePromptProjectionCount: 0,
      policy: "resolved-issues-only-sorted-lf-trim-v1",
      sourcePullTitleBodyExcluded: true,
      stage1Binding:
        "source-row-only-agent-visible-prompt-not-materialized",
      status: "policy-defined-projection-materialization-required",
    },
    qualification: {
      path:
        "multi-swe-full-56ff018.real-history-transition-qualification.json",
      sha256:
        "59136d44da3f5687afe08cffbed98f0eae71a114389114cb422b73680c1185f8",
    },
    schemaVersion: 3,
    trajectory: {
      path: "multi-swe-full-56ff018.review-trajectory-discovery.json",
      sha256:
        "5931a911b919a9c53068311185f0bd1c78c0be18220ebe92c3b795c8e38357fd",
    },
  };
  refreshAssessmentSha(ledger.assessments[0]!);
  return ledger;
}

function rankTwoAssessment() {
  const assessment = {
    anchorId: "mui/material-ui#37850",
    blockingStagePositions: [2, 3],
    cappedPoolRank: 2,
    decisionReason: "semantic-dependency-rejected",
    finding:
      "The frozen review targets do not align with their selected fix commits.",
    screeningDecision: "reject",
    stages: [
      {
        afterCommit: "edf1b7d12b1ee393a494211d0fbe0635206d6e27",
        beforeCommit: null,
        classification: "behavioral-coding-request",
        finding:
          "The original Badge pull request is behavioral; its historical base snapshot remains deferred to machine qualification.",
        position: 1,
        targetKind: "source-row",
        targetSha256:
          "d81528f6ef9669bf820a80c01a0ac07a521099f09b3e5643e7113b8db4a487bc",
      },
      {
        afterCommit: "26db4d893b08a707556519c699a1b317086ced0f",
        beforeCommit: "edf1b7d12b1ee393a494211d0fbe0635206d6e27",
        classification: "ambiguous-review-request",
        finding:
          "The selected question does not choose a migration policy and the fix only renames variant to size.",
        position: 2,
        targetKind: "review-comment",
        targetSha256:
          "e963560faf85b9ad6508f89386d83eb4b350f6887c7e405a1d231c015f54cf52",
      },
      {
        afterCommit: "98fe0bab4a1b8ee053332ba5062a3ffbe57d3226",
        beforeCommit: "b2b0aa6238cc2567c6d6e366c9b86872aab2c389",
        classification: "behavioral-request-transition-mismatch",
        finding:
          "The review requests one-prop-per-class behavior, but the selected fix only changes warning palette values.",
        position: 3,
        targetKind: "review-comment",
        targetSha256:
          "b0413a5ed4eb5bf96f8ec8e302f9651cbc696e2947ab2471fb86f4011bcc3bc8",
      },
    ],
    review: {
      assessmentSha256: "",
      authorTaskName: "/root",
      contextPolicy: "fork-turns-none",
      cryptographicReceipt: false,
      hiddenEvaluatorAccess: false,
      outcomeAccess: false,
      rawGoldAccess: false,
      reviewedAt: "2026-07-25T20:00:00.000Z",
      reviewerAgentName: "/root/c6_rank2_mui_gold_blind_review",
    },
  };
  refreshAssessmentSha(assessment);
  return assessment;
}

function refreshAssessmentSha(assessment: {
  review: { assessmentSha256: string };
}): void {
  const { review, ...payload } = assessment;
  review.assessmentSha256 = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}
