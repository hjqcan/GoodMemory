import {
  describe,
  expect,
  it,
  setDefaultTimeout,
} from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  replayC6RestReviewerActorFilteredQualification,
} from "../../../scripts/codex-coding-effect/c6-rest-reviewer-actor-filtered-qualification";
import {
  deriveC6ReviewerActorQualifiedScreeningCapacity,
  replayC6ReviewerActorQualifiedScreeningFrame,
} from "../../../scripts/codex-coding-effect/c6-reviewer-actor-qualified-screening-frame";
import {
  replayC6ReviewerActorFilteredQualification,
} from "../../../scripts/codex-coding-effect/c6-reviewer-actor-filtered-qualification";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool",
);
const EXTERNAL = {
  liveActor:
    process.env.GOODMEMORY_TEST_C6_LIVE_MULTILANG_ACTOR_ROOT?.trim(),
  liveGraphql:
    process.env.GOODMEMORY_TEST_C6_LIVE_MULTILANG_GRAPHQL_ROOT?.trim(),
  multiSweActor:
    process.env.GOODMEMORY_TEST_C6_MULTI_SWE_ACTOR_ROOT?.trim(),
  multiSweGraphql:
    process.env.GOODMEMORY_TEST_C6_MULTI_SWE_GRAPHQL_ROOT?.trim(),
  multiSweOriginalRest:
    process.env.GOODMEMORY_TEST_C6_MULTI_SWE_ORIGINAL_REST_ROOT?.trim(),
  multiSweSupplementRest:
    process.env.GOODMEMORY_TEST_C6_MULTI_SWE_SUPPLEMENT_REST_ROOT?.trim(),
  multilingualActor:
    process.env.GOODMEMORY_TEST_C6_MULTILINGUAL_ACTOR_ROOT?.trim(),
  multilingualGraphql:
    process.env.GOODMEMORY_TEST_C6_MULTILINGUAL_GRAPHQL_ROOT?.trim(),
};
const missingExternalRoots = Object.entries(EXTERNAL)
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missingExternalRoots.length > 0) {
  throw new Error(
    `C6 actor frame gate missing external roots: ${
      missingExternalRoots.join(", ")
    }`,
  );
}

const HASHES = {
  actorFrame:
    "6838de7f36875b3b3de104ffd896b9e30dcf95ad1eb285a87b465789800f4b0c",
  frameV2:
    "9afc398b3475d5f4f6ab016c8fa36df80ed74880971acad789b54cbf4fcc022e",
  frameV3:
    "028d7c8de236cfdd20369f324e275b5358b829ed0f38e6bcac1e8a230c8e0ccd",
  frameV4:
    "b6336741464f50cbd71ee7a967500e7f2543779e83d8ac8e20dcd7cea895b375",
  liveQualification:
    "728453138ee33e6b6e5525ea6e3555c998d9f17774afed8da18c8ff845283a66",
  multiSweQualification:
    "69e6417308279fb398cdec5abdf7b41e77d501097830264a502175815e8e98f8",
  multilingualQualification:
    "7fb942cd87126d360ed820e91cf8bee1073153cd21c674eeb91d3cb09b05929f",
} as const;

setDefaultTimeout(300_000);

describe(
  "Codex coding-effect C6 reviewer actor-qualified screening frame gate",
  () => {
    it("replays all actor closures and the prospective-only 113-candidate frame", async () => {
      const paths = {
        actorFrame: sourcePath(
          "multi-source.reviewer-actor-qualified-screening-frame-v1.json",
        ),
        frameV2: sourcePath(
          "multi-swe-full-56ff018.source-expansion-screening-frame-v2.json",
        ),
        frameV3: sourcePath(
          "multi-source.source-expansion-screening-frame-v3.json",
        ),
        frameV4: sourcePath(
          "multi-source.source-expansion-screening-frame-v4.json",
        ),
        liveActorPlan: sourcePath(
          "swe-bench-live-multilang-608f7ae9.reviewer-actor-identity-plan-v1.json",
        ),
        liveBaseQualification: sourcePath(
          "swe-bench-live-multilang-608f7ae9.source-expansion-qualification-v1.json",
        ),
        liveQualification: sourcePath(
          "swe-bench-live-multilang-608f7ae9.reviewer-actor-filtered-qualification-v1.json",
        ),
        multiSweActorPlan: sourcePath(
          "multi-swe-full-56ff018.reviewer-actor-identity-plan-v1.json",
        ),
        multiSweBaseQualification: sourcePath(
          "multi-swe-full-56ff018.review-trajectory-source-expansion-rest-qualification-v2.json",
        ),
        multiSweQualification: sourcePath(
          "multi-swe-full-56ff018.reviewer-actor-filtered-qualification-v1.json",
        ),
        multilingualActorPlan: sourcePath(
          "swe-bench-multilingual-e5c585e.reviewer-actor-identity-plan-v1.json",
        ),
        multilingualBaseQualification: sourcePath(
          "swe-bench-multilingual-e5c585e.source-expansion-qualification-v1.json",
        ),
        multilingualQualification: sourcePath(
          "swe-bench-multilingual-e5c585e.reviewer-actor-filtered-qualification-v1.json",
        ),
      };
      const [
        actorFrameBytes,
        frameV2Bytes,
        frameV3Bytes,
        frameV4Bytes,
        liveBytes,
        multiSweBytes,
        multilingualBytes,
      ] = await Promise.all([
        readFile(paths.actorFrame),
        readFile(paths.frameV2),
        readFile(paths.frameV3),
        readFile(paths.frameV4),
        readFile(paths.liveQualification),
        readFile(paths.multiSweQualification),
        readFile(paths.multilingualQualification),
      ]);
      expect(sha256(actorFrameBytes)).toBe(HASHES.actorFrame);
      expect(sha256(frameV2Bytes)).toBe(HASHES.frameV2);
      expect(sha256(frameV3Bytes)).toBe(HASHES.frameV3);
      expect(sha256(frameV4Bytes)).toBe(HASHES.frameV4);
      expect(sha256(liveBytes)).toBe(HASHES.liveQualification);
      expect(sha256(multiSweBytes)).toBe(
        HASHES.multiSweQualification,
      );
      expect(sha256(multilingualBytes)).toBe(
        HASHES.multilingualQualification,
      );

      const liveArtifact = parseQualification(liveBytes);
      const multiSweArtifact = parseQualification(multiSweBytes);
      const multilingualArtifact =
        parseQualification(multilingualBytes);
      const [live, multiSwe, multilingual] = await Promise.all([
        replayC6ReviewerActorFilteredQualification({
          actorPlanPath: paths.liveActorPlan,
          actorRoot: required(
            EXTERNAL.liveActor,
            "GOODMEMORY_TEST_C6_LIVE_MULTILANG_ACTOR_ROOT",
          ),
          baseQualificationPath: paths.liveBaseQualification,
          expectedActorPlanSha256:
            liveArtifact.inputs.actorPlanSha256,
          expectedActorRootSha256:
            liveArtifact.inputs.actorRootSha256,
          expectedBaseQualificationSha256:
            liveArtifact.inputs.baseQualificationSha256,
          expectedGraphqlRootSha256:
            liveArtifact.inputs.graphqlRootSha256,
          expectedProjectionSha256: HASHES.liveQualification,
          graphqlRoot: required(
            EXTERNAL.liveGraphql,
            "GOODMEMORY_TEST_C6_LIVE_MULTILANG_GRAPHQL_ROOT",
          ),
          projectionPath: paths.liveQualification,
        }),
        replayC6RestReviewerActorFilteredQualification({
          actorPlanPath: paths.multiSweActorPlan,
          actorRoot: required(
            EXTERNAL.multiSweActor,
            "GOODMEMORY_TEST_C6_MULTI_SWE_ACTOR_ROOT",
          ),
          baseQualificationPath: paths.multiSweBaseQualification,
          expectedActorPlanSha256:
            multiSweArtifact.inputs.actorPlanSha256,
          expectedActorRootSha256:
            multiSweArtifact.inputs.actorRootSha256,
          expectedBaseQualificationSha256:
            multiSweArtifact.inputs.baseQualificationSha256,
          expectedGraphqlRootSha256:
            multiSweArtifact.inputs.graphqlRootSha256,
          expectedOriginalRestRootSha256:
            requiredPullAuthorRoot(
              multiSweArtifact,
              "originalRestRootSha256",
            ),
          expectedProjectionSha256:
            HASHES.multiSweQualification,
          expectedSupplementRootSha256:
            requiredPullAuthorRoot(
              multiSweArtifact,
              "supplementRootSha256",
            ),
          graphqlRoot: required(
            EXTERNAL.multiSweGraphql,
            "GOODMEMORY_TEST_C6_MULTI_SWE_GRAPHQL_ROOT",
          ),
          originalRestRoot: required(
            EXTERNAL.multiSweOriginalRest,
            "GOODMEMORY_TEST_C6_MULTI_SWE_ORIGINAL_REST_ROOT",
          ),
          projectionPath: paths.multiSweQualification,
          supplementRoot: required(
            EXTERNAL.multiSweSupplementRest,
            "GOODMEMORY_TEST_C6_MULTI_SWE_SUPPLEMENT_REST_ROOT",
          ),
        }),
        replayC6ReviewerActorFilteredQualification({
          actorPlanPath: paths.multilingualActorPlan,
          actorRoot: required(
            EXTERNAL.multilingualActor,
            "GOODMEMORY_TEST_C6_MULTILINGUAL_ACTOR_ROOT",
          ),
          baseQualificationPath:
            paths.multilingualBaseQualification,
          expectedActorPlanSha256:
            multilingualArtifact.inputs.actorPlanSha256,
          expectedActorRootSha256:
            multilingualArtifact.inputs.actorRootSha256,
          expectedBaseQualificationSha256:
            multilingualArtifact.inputs.baseQualificationSha256,
          expectedGraphqlRootSha256:
            multilingualArtifact.inputs.graphqlRootSha256,
          expectedProjectionSha256:
            HASHES.multilingualQualification,
          graphqlRoot: required(
            EXTERNAL.multilingualGraphql,
            "GOODMEMORY_TEST_C6_MULTILINGUAL_GRAPHQL_ROOT",
          ),
          projectionPath: paths.multilingualQualification,
        }),
      ]);
      expect(live.reproduced).toBe(true);
      expect(multiSwe.reproduced).toBe(true);
      expect(multilingual.reproduced).toBe(true);
      expect(live.qualification.counts).toMatchObject({
        actorFilteredExactFreshCandidateCount: 47,
        actorFilteredNoExactFreshSequenceCount: 17,
        priorFrameOverlapCount: 0,
        targetCount: 64,
      });
      expect(multiSwe.qualification.counts).toMatchObject({
        actorFilteredExactFreshCandidateCount: 44,
        actorFilteredNoExactFreshSequenceCount: 7,
        priorFrameOverlapCount: 0,
        targetCount: 51,
      });
      expect(multilingual.qualification.counts).toMatchObject({
        actorFilteredExactFreshCandidateCount: 19,
        actorFilteredNoExactFreshSequenceCount: 4,
        priorFrameOverlapCount: 3,
        targetCount: 26,
      });

      const frame =
        await replayC6ReviewerActorQualifiedScreeningFrame({
          expectedFrameSha256: HASHES.actorFrame,
          expectedLiveMultilangQualificationSha256:
            HASHES.liveQualification,
          expectedMultiSweQualificationSha256:
            HASHES.multiSweQualification,
          expectedMultilingualQualificationSha256:
            HASHES.multilingualQualification,
          expectedSupersededFrameSha256: HASHES.frameV4,
          framePath: paths.actorFrame,
          liveMultilangQualificationPath:
            paths.liveQualification,
          multiSweQualificationPath:
            paths.multiSweQualification,
          multilingualQualificationPath:
            paths.multilingualQualification,
          supersededFramePath: paths.frameV4,
        });
      expect(frame.reproduced).toBe(true);
      expect(frame.frame.counts).toEqual({
        actorRequalifiedPriorFrameOverlapCount: 3,
        combinedStructuralCandidateCount: 113,
        currentFrameScreeningBufferRequired: 72,
        deduplicatedCandidateCount: 0,
        headlineMinimumEpisodeFloor: 391,
        headlineRawCandidateShortfall: 278,
        headlineRepositoryCappedStructuralShortfall: 298,
        liveMultilangActorQualifiedCandidateCount: 47,
        liveMultilangQualificationTargetCount: 64,
        multiSweActorQualifiedCandidateCount: 44,
        multiSweQualificationTargetCount: 51,
        multilingualActorQualifiedCandidateCount: 22,
        multilingualQualificationTargetCount: 26,
        repositoryCappedStructuralCeiling: 93,
        repositoryCount: 57,
        screeningBatchMinimumEpisodes: 48,
        screeningBatchRepositoryCappedMargin: 45,
      });
      expect(frame.frame.independenceBoundary).toMatchObject({
        candidateProjectionSha256:
          "1d0c5689521aa906e7fb2bf015579bbcc7638b31093966edec5339724aec82af",
        legacyCandidateInput: false,
        legacySemanticLedgerInput: false,
        machineOutcomeInput: false,
        semanticLedgerInput: false,
        supersededFrameCandidateInput: false,
        trancheOrderFrozenBeforeSemanticScreening: true,
      });
      expect(frame.frame.boundary).toMatchObject({
        acceptedEpisodeCount: 0,
        automationExclusionComplete: false,
        candidateManifestFrozen: false,
        codexRunReady: false,
        currentFrameSemanticScreeningReady: true,
        eventTimeActorTypeProven: false,
        headlineRawStructuralCandidateFloorMet: false,
        humanReviewerIdentityProven: false,
        machineQualifiedEpisodeCount: 0,
        status:
          "platform-user-filtered-prospective-screening-batch-structural-only",
        structuralCapacityOnly: true,
      });
      expect(
        deriveC6ReviewerActorQualifiedScreeningCapacity({
          frame: frame.frame,
          rejectedRequestedAnchorIds: [],
        }),
      ).toEqual({
        canMeetHeadlineMinimumUnderRepositoryCap: false,
        canMeetScreeningBatchMinimumUnderRepositoryCap: true,
        currentFrameSemanticScreeningReady: true,
        definitiveRejectedCandidateCount: 0,
        headlineMinimumEpisodeFloor: 391,
        headlineSelectableMargin: -298,
        remainingStructuralCandidateCount: 113,
        repositoryCappedStructuralCeiling: 93,
        screeningBatchMinimumEpisodes: 48,
        screeningBatchSelectableMargin: 45,
      });
    });
  },
);

interface QualificationArtifact {
  inputs: {
    actorPlanSha256: string;
    actorRootSha256: string;
    baseQualificationSha256: string;
    graphqlRootSha256: string;
    pullAuthorRoots?: {
      originalRestRootSha256: string;
      supplementRootSha256: string;
    };
  };
}

function parseQualification(
  bytes: Uint8Array,
): QualificationArtifact {
  return JSON.parse(
    Buffer.from(bytes).toString("utf8"),
  ) as QualificationArtifact;
}

function requiredPullAuthorRoot(
  artifact: QualificationArtifact,
  key: "originalRestRootSha256" | "supplementRootSha256",
): string {
  const value = artifact.inputs.pullAuthorRoots?.[key];
  if (value === undefined) {
    throw new Error(`C6 actor gate missing ${key}`);
  }
  return value;
}

function required(
  value: string | undefined,
  name: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for the C6 actor gate`);
  }
  return value;
}

function sourcePath(name: string): string {
  return join(SOURCE_ROOT, name);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
