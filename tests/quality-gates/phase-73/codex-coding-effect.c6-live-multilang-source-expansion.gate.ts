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
  deriveC6SourceExpansionScreeningFrameV4Capacity,
  replayC6SourceExpansionScreeningFrameV4,
} from "../../../scripts/codex-coding-effect/c6-source-expansion-screening-frame-v4";
import {
  projectC6SWEbenchLiveMultiLangCapturePlan,
  serializeC6SWEbenchLiveMultiLangCapturePlan,
} from "../../../scripts/codex-coding-effect/c6-swe-bench-live-multilang-capture-plan";
import {
  loadC6SWEbenchLiveMultiLangSourcePool,
  serializeC6SWEbenchLiveMultiLangSourcePool,
} from "../../../scripts/codex-coding-effect/c6-swe-bench-live-multilang-source-pool";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_ROOT =
  process.env.GOODMEMORY_TEST_C6_LIVE_MULTILANG_SOURCE_ROOT?.trim();
const GRAPHQL_ROOT =
  process.env.GOODMEMORY_TEST_C6_LIVE_MULTILANG_GRAPHQL_ROOT?.trim();
const IDENTITY_ROOT =
  process.env.GOODMEMORY_TEST_C6_LIVE_MULTILANG_IDENTITY_ROOT?.trim();
const maybeDescribe =
  SOURCE_ROOT && GRAPHQL_ROOT && IDENTITY_ROOT
    ? describe
    : describe.skip;
const SOURCE_POOL_SHA256 =
  "8c53bcb359a6cde71207a69ca5b8630d6ea299f3fdc7219db958f86cb499e4ec";
const CAPTURE_PLAN_SHA256 =
  "3923d3de3fd1bc5906530b918e2ca4c38cf0e83e3f93d1c590447dce1f5d1f37";
const GRAPHQL_ROOT_SHA256 =
  "8b8ad4ac1b3b1f92b0d352cb808eef0953ac07cd1bf74eb9f61d592f4e481dcc";
const PRIOR_FRAME_SHA256 =
  "028d7c8de236cfdd20369f324e275b5358b829ed0f38e6bcac1e8a230c8e0ccd";
const EXPANSION_SHA256 =
  "5c0202ba4d03fc7d59381351f4542b9d9619f539d498f619d0e41d7acf0e9d76";
const IDENTITY_PLAN_SHA256 =
  "0f8180b8343c02b70c14e6501207b6ef8bdef1462f731f7b07368b39c1e3644f";
const IDENTITY_ROOT_SHA256 =
  "36198098fe9da4656c5fbf3eee163f723985c97956dc9939371ea00aa70a711c";
const QUALIFICATION_SHA256 =
  "ccf5a3bdd93955b90e416c4a861000adba7526103e21c1cd5898600743305760";
const FRAME_V4_SHA256 =
  "b6336741464f50cbd71ee7a967500e7f2543779e83d8ac8e20dcd7cea895b375";
const SEMANTIC_LEDGER_SHA256 =
  "35a5ebc83da5a6ac4c3bc799d6d7484d7fc89e049b5ddb3e8b9ee752c9cc4796";
const MACHINE_EVIDENCE_SHA256 =
  "5235b39c9bffd688a62e384edf77c9ae165c7c9d898bb2ea83d821a74e1c12f8";

setDefaultTimeout(300_000);

maybeDescribe("Codex coding-effect C6 Live MultiLang expansion gate", () => {
  it("replays the pinned source, 743 closures, 64 identities, and frame-v4 capacity", async () => {
    const sourcePoolRoot = join(
      REPOSITORY_ROOT,
      "fixtures/codex-coding-effect/c6-source-pool",
    );
    const sourcePoolPath = join(
      sourcePoolRoot,
      "swe-bench-live-multilang-608f7ae9.source-pool.json",
    );
    const capturePlanPath = join(
      sourcePoolRoot,
      "swe-bench-live-multilang-608f7ae9.capture-plan-v1.json",
    );
    const sourcePoolBytes = await readFile(sourcePoolPath);
    expect(sha256(sourcePoolBytes)).toBe(SOURCE_POOL_SHA256);
    const sourcePool = await loadC6SWEbenchLiveMultiLangSourcePool({
      sourceRoot: requiredExternalPath(
        SOURCE_ROOT,
        "GOODMEMORY_TEST_C6_LIVE_MULTILANG_SOURCE_ROOT",
      ),
    });
    expect(serializeC6SWEbenchLiveMultiLangSourcePool(sourcePool))
      .toBe(sourcePoolBytes.toString("utf8"));

    const capturePlanBytes = await readFile(capturePlanPath);
    expect(sha256(capturePlanBytes)).toBe(CAPTURE_PLAN_SHA256);
    const capturePlan = projectC6SWEbenchLiveMultiLangCapturePlan({
      sourcePoolBytes,
      sourcePoolPath,
    });
    expect(serializeC6SWEbenchLiveMultiLangCapturePlan(capturePlan))
      .toBe(capturePlanBytes.toString("utf8"));
    expect(capturePlan.counts).toMatchObject({
      repositoryCount: 381,
      sourceRowCount: 743,
      targetCount: 743,
    });

    const expansionPath = join(
      sourcePoolRoot,
      "swe-bench-live-multilang-608f7ae9.review-trajectory-expansion-v1.json",
    );
    const expansion =
      await replayC6MultilingualReviewTrajectoryExpansion({
        capturePlanPath,
        expectedCapturePlanSha256: CAPTURE_PLAN_SHA256,
        expectedGraphqlRootSha256: GRAPHQL_ROOT_SHA256,
        expectedPriorFrameSha256: PRIOR_FRAME_SHA256,
        expectedProjectionSha256: EXPANSION_SHA256,
        graphqlRoot: requiredExternalPath(
          GRAPHQL_ROOT,
          "GOODMEMORY_TEST_C6_LIVE_MULTILANG_GRAPHQL_ROOT",
        ),
        priorFramePath: join(
          sourcePoolRoot,
          "multi-source.source-expansion-screening-frame-v3.json",
        ),
        projectionPath: expansionPath,
      });
    expect(expansion.reproduced).toBe(true);
    expect(expansion.expansion.counts).toMatchObject({
      broadStructuralPretargetCount: 64,
      capturedClosureCount: 743,
      freshBroadStructuralPretargetCount: 64,
      priorFrameOverlapCount: 0,
      unsupportedPaginationCount: 2,
    });

    const qualificationPath = join(
      sourcePoolRoot,
      "swe-bench-live-multilang-608f7ae9.source-expansion-qualification-v1.json",
    );
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
          "GOODMEMORY_TEST_C6_LIVE_MULTILANG_GRAPHQL_ROOT",
        ),
        identityPlanPath: join(
          sourcePoolRoot,
          "swe-bench-live-multilang-608f7ae9.pull-identity-plan-v1.json",
        ),
        identityRoot: requiredExternalPath(
          IDENTITY_ROOT,
          "GOODMEMORY_TEST_C6_LIVE_MULTILANG_IDENTITY_ROOT",
        ),
        projectionPath: qualificationPath,
      });
    expect(qualification.reproduced).toBe(true);
    expect(qualification.qualification.counts).toEqual({
      exactFreshCandidateCount: 63,
      exactFreshRepositoryCount: 39,
      identityClosureCount: 64,
      noExactFreshSequenceCount: 1,
      priorFrameOverlapCount: 0,
      repositoryCappedFreshCeiling: 57,
      targetCount: 64,
    });

    const frame = await replayC6SourceExpansionScreeningFrameV4({
      expectedFrameSha256: FRAME_V4_SHA256,
      expectedPriorFrameSha256: PRIOR_FRAME_SHA256,
      expectedQualificationSha256: QUALIFICATION_SHA256,
      framePath: join(
        sourcePoolRoot,
        "multi-source.source-expansion-screening-frame-v4.json",
      ),
      priorFramePath: join(
        sourcePoolRoot,
        "multi-source.source-expansion-screening-frame-v3.json",
      ),
      qualificationPath,
    });
    expect(frame.reproduced).toBe(true);
    expect(frame.frame.counts).toMatchObject({
      combinedStructuralCandidateCount: 272,
      liveMultilangExactCandidateCount: 63,
      priorFrameCandidateCount: 209,
      repositoryCappedStructuralCeiling: 138,
      repositoryCount: 72,
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
    const rejects = [
      ...semanticLedger.assessments.filter(
        (assessment) => assessment.screeningDecision === "reject",
      ).map((assessment) => assessment.anchorId),
      ...machineEvidence.assessments.filter(
        (assessment) =>
          assessment.decision === "reject-machine-qualification"
      ).map((assessment) => assessment.anchorId),
    ];
    expect(rejects).toHaveLength(38);
    expect(deriveC6SourceExpansionScreeningFrameV4Capacity({
      frame: frame.frame,
      rejectedRequestedAnchorIds: rejects,
    })).toEqual({
      canMeetMinimumUnderRepositoryCap: true,
      canStartFullSemanticScreening: true,
      definitiveRejectedCandidateCount: 38,
      fullScreeningBufferRequired: 72,
      minimumRequiredEpisodes: 48,
      remainingStructuralCandidateCount: 234,
      repositoryCappedStructuralCeiling: 122,
      selectableMargin: 74,
    });
  });
});

function requiredExternalPath(
  value: string | undefined,
  name: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for the C6 Live MultiLang gate`);
  }
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
