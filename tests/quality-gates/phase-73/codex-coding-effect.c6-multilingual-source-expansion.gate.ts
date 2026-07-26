import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  replayC6MultilingualReviewTrajectoryExpansion,
} from "../../../scripts/codex-coding-effect/c6-multilingual-review-trajectory-expansion";
import {
  replayC6MultilingualSourceExpansionQualification,
} from "../../../scripts/codex-coding-effect/c6-multilingual-source-expansion-qualification";
import {
  deriveC6SourceExpansionScreeningFrameV3Capacity,
  replayC6SourceExpansionScreeningFrameV3,
} from "../../../scripts/codex-coding-effect/c6-source-expansion-screening-frame-v3";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const GRAPHQL_ROOT =
  process.env.GOODMEMORY_TEST_C6_MULTILINGUAL_GRAPHQL_ROOT?.trim();
const IDENTITY_ROOT =
  process.env.GOODMEMORY_TEST_C6_MULTILINGUAL_IDENTITY_ROOT?.trim();
const maybeDescribe =
  GRAPHQL_ROOT && IDENTITY_ROOT ? describe : describe.skip;
const CAPTURE_PLAN_SHA256 =
  "077908ee5717bc20c8a967d207d658bc001cc596013b853bb0f4fef8e5f69538";
const GRAPHQL_ROOT_SHA256 =
  "397ced8b4aab15ca0b1e03f2bec64a3a3fd0b17b74540c0d83127071350c99a2";
const PRIOR_FRAME_SHA256 =
  "9afc398b3475d5f4f6ab016c8fa36df80ed74880971acad789b54cbf4fcc022e";
const EXPANSION_SHA256 =
  "50197487c467753d874756b9946452c88aebddb6da8356e6081b6b0485482736";
const IDENTITY_PLAN_SHA256 =
  "66ee379d66ff5a40c189d6eef4a2d0929369ff9fc5e4a080b49a1c73e36f463e";
const IDENTITY_ROOT_SHA256 =
  "b4ef9678039b39bb1185286c0b5dad0ae0bb14a581a8f0511bf8a961fe24049a";
const QUALIFICATION_SHA256 =
  "3cf7722c1fa76a5da48ef312211a6358c5a266fe414e69288ee1c23fd9fca115";
const FRAME_V3_SHA256 =
  "028d7c8de236cfdd20369f324e275b5358b829ed0f38e6bcac1e8a230c8e0ccd";
const SEMANTIC_LEDGER_SHA256 =
  "35a5ebc83da5a6ac4c3bc799d6d7484d7fc89e049b5ddb3e8b9ee752c9cc4796";
const MACHINE_EVIDENCE_SHA256 =
  "5235b39c9bffd688a62e384edf77c9ae165c7c9d898bb2ea83d821a74e1c12f8";

setDefaultTimeout(300_000);

maybeDescribe("Codex coding-effect C6 multilingual expansion gate", () => {
  it("replays 300 GraphQL closures and exact-qualifies 26 pull identities", async () => {
    const sourcePoolRoot = join(
      REPOSITORY_ROOT,
      "fixtures/codex-coding-effect/c6-source-pool",
    );
    const expansionPath = join(
      sourcePoolRoot,
      "swe-bench-multilingual-e5c585e.review-trajectory-expansion-v1.json",
    );
    const replay = await replayC6MultilingualReviewTrajectoryExpansion({
      capturePlanPath: join(
        sourcePoolRoot,
        "swe-bench-multilingual-e5c585e.source-expansion-capture-plan-v1.json",
      ),
      expectedCapturePlanSha256: CAPTURE_PLAN_SHA256,
      expectedGraphqlRootSha256: GRAPHQL_ROOT_SHA256,
      expectedPriorFrameSha256: PRIOR_FRAME_SHA256,
      expectedProjectionSha256: EXPANSION_SHA256,
      graphqlRoot: requiredExternalPath(
        GRAPHQL_ROOT,
        "GOODMEMORY_TEST_C6_MULTILINGUAL_GRAPHQL_ROOT",
      ),
      priorFramePath: join(
        sourcePoolRoot,
        "multi-swe-full-56ff018.source-expansion-screening-frame-v2.json",
      ),
      projectionPath: expansionPath,
    });
    expect(replay.reproduced).toBe(true);
    expect(replay.expansion.counts).toMatchObject({
      broadStructuralPretargetCount: 26,
      capturedClosureCount: 300,
      freshBroadStructuralPretargetCount: 23,
      priorFrameOverlapCount: 3,
      unsupportedPaginationCount: 1,
    });

    const qualification =
      await replayC6MultilingualSourceExpansionQualification({
        expectedExpansionSha256: EXPANSION_SHA256,
        expectedGraphqlRootSha256: GRAPHQL_ROOT_SHA256,
        expectedIdentityPlanSha256: IDENTITY_PLAN_SHA256,
        expectedIdentityRootSha256: IDENTITY_ROOT_SHA256,
        expectedProjectionSha256: QUALIFICATION_SHA256,
        expansionPath,
        graphqlRoot: requiredExternalPath(
          GRAPHQL_ROOT,
          "GOODMEMORY_TEST_C6_MULTILINGUAL_GRAPHQL_ROOT",
        ),
        identityPlanPath: join(
          sourcePoolRoot,
          "swe-bench-multilingual-e5c585e.pull-identity-plan-v1.json",
        ),
        identityRoot: requiredExternalPath(
          IDENTITY_ROOT,
          "GOODMEMORY_TEST_C6_MULTILINGUAL_IDENTITY_ROOT",
        ),
        projectionPath: join(
          sourcePoolRoot,
          "swe-bench-multilingual-e5c585e.source-expansion-qualification-v1.json",
        ),
      });
    expect(qualification.reproduced).toBe(true);
    expect(qualification.projectionSha256).toBe(QUALIFICATION_SHA256);
    expect(qualification.qualification.counts).toEqual({
      exactFreshCandidateCount: 20,
      exactFreshRepositoryCount: 14,
      identityClosureCount: 26,
      noExactFreshSequenceCount: 3,
      priorFrameOverlapCount: 3,
      repositoryCappedFreshCeiling: 20,
      targetCount: 26,
    });
    expect(qualification.qualification.boundary).toMatchObject({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
    });

    const framePath = join(
      sourcePoolRoot,
      "multi-source.source-expansion-screening-frame-v3.json",
    );
    const frame = await replayC6SourceExpansionScreeningFrameV3({
      expectedFrameSha256: FRAME_V3_SHA256,
      expectedPriorFrameSha256: PRIOR_FRAME_SHA256,
      expectedQualificationSha256: QUALIFICATION_SHA256,
      framePath,
      priorFramePath: join(
        sourcePoolRoot,
        "multi-swe-full-56ff018.source-expansion-screening-frame-v2.json",
      ),
      qualificationPath: join(
        sourcePoolRoot,
        "swe-bench-multilingual-e5c585e.source-expansion-qualification-v1.json",
      ),
    });
    expect(frame.reproduced).toBe(true);
    expect(frame.frame.counts).toMatchObject({
      combinedStructuralCandidateCount: 209,
      multilingualExactCandidateCount: 20,
      priorFrameCandidateCount: 189,
      repositoryCappedStructuralCeiling: 82,
    });

    const semanticLedgerBytes = await readFile(join(
      sourcePoolRoot,
      "multi-swe-full-56ff018.real-history-semantic-screening.json",
    ));
    const machineEvidenceBytes = await readFile(join(
      REPOSITORY_ROOT,
      "fixtures/codex-coding-effect/" +
        "c6-fmt974-transition-evaluator-screening/evidence.json",
    ));
    expect(sha256(semanticLedgerBytes)).toBe(SEMANTIC_LEDGER_SHA256);
    expect(sha256(machineEvidenceBytes)).toBe(MACHINE_EVIDENCE_SHA256);
    const semanticLedger = JSON.parse(
      semanticLedgerBytes.toString("utf8"),
    ) as {
      assessments: Array<{
        anchorId: string;
        screeningDecision: string;
      }>;
    };
    const machineEvidence = JSON.parse(
      machineEvidenceBytes.toString("utf8"),
    ) as {
      assessments: Array<{
        anchorId: string;
        decision: string;
      }>;
    };
    const semanticRejects = semanticLedger.assessments.filter(
      (assessment) => assessment.screeningDecision === "reject",
    ).map((assessment) => assessment.anchorId);
    const machineRejects = machineEvidence.assessments.filter(
      (assessment) =>
        assessment.decision === "reject-machine-qualification"
    ).map((assessment) => assessment.anchorId);
    expect(semanticRejects).toHaveLength(37);
    expect(machineRejects).toEqual(["fmtlib/fmt#974"]);
    expect(deriveC6SourceExpansionScreeningFrameV3Capacity({
      frame: frame.frame,
      rejectedRequestedAnchorIds: [
        ...semanticRejects,
        ...machineRejects,
      ],
    })).toEqual({
      canMeetMinimumUnderRepositoryCap: true,
      canStartFullSemanticScreening: false,
      definitiveRejectedCandidateCount: 38,
      fullScreeningBufferRequired: 72,
      minimumRequiredEpisodes: 48,
      remainingStructuralCandidateCount: 171,
      repositoryCappedStructuralCeiling: 66,
      selectableMargin: 18,
    });
  });
});

function requiredExternalPath(
  value: string | undefined,
  name: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for the C6 multilingual gate`);
  }
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
