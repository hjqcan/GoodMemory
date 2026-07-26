import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  buildC6LiveMultiLangNeighborCommitCountEligibilityPlan,
  C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY_POLICY,
  parseC6LiveMultiLangNeighborCommitCountEligibilityPlan,
  serializeC6LiveMultiLangNeighborCommitCountEligibilityPlan,
  serializeC6LiveMultiLangNeighborCommitCountEligibilityQueryPolicy,
} from "../../../scripts/codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-plan";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_POOL_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool",
);
const SOURCE_PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "neighbor-deep-capture-plan-v2.json",
);
const ARTIFACT_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "neighbor-commit-count-eligibility-plan-v1.json",
);
const SOURCE_PLAN_SHA256 =
  "9af58b2033aa67d8bb1d056ff0f56fe8db9c1b0c7a75f73ed1a6a784ad0f4472";
const SOURCE_TARGET_PROJECTION_SHA256 =
  "9b1249a93f2878c41d258cdb2212facf26e4c810f2ed7322d1fcd23fe867eacf";
const ARTIFACT_SHA256 =
  "eebd85d07feb0346455bcdba1cc4a180346b2e8473191008647653bd4aea301a";
const ARTIFACT_BYTES = 483_447;
const QUERY_SHA256 =
  "c7df2986012e6aab36c75a9f1614cb366bcb48b2934b0c07406ebb6172d2f7e0";
const POLICY_SHA256 =
  "84b037e1bb34fae1fa03f4c7300d6bcc924e3ce2e5414a9729a51eab3dce5c70";

describe(
  "Codex coding-effect C6 Wave2 commit-count eligibility plan gate",
  () => {
    it("matches the tracked canonical artifact byte-for-byte", async () => {
      const [artifactBytes, replay] = await Promise.all([
        readFile(ARTIFACT_PATH),
        buildC6LiveMultiLangNeighborCommitCountEligibilityPlan({
          sourcePlanPath: SOURCE_PLAN_PATH,
        }),
      ]);

      expect(artifactBytes.byteLength).toBe(ARTIFACT_BYTES);
      expect(sha256(artifactBytes)).toBe(ARTIFACT_SHA256);
      expect(replay.outputSha256).toBe(ARTIFACT_SHA256);
      expect(Buffer.from(
        serializeC6LiveMultiLangNeighborCommitCountEligibilityPlan(
          replay.plan,
        ),
      )).toEqual(artifactBytes);
      expect(
        parseC6LiveMultiLangNeighborCommitCountEligibilityPlan(
          artifactBytes,
        ),
      ).toEqual(replay.plan);
    });

    it("freezes all 643 targets, the transport rule, and honest chronology", async () => {
      const [sourceBytes, replay] = await Promise.all([
        readFile(SOURCE_PLAN_PATH),
        buildC6LiveMultiLangNeighborCommitCountEligibilityPlan({
          sourcePlanPath: SOURCE_PLAN_PATH,
        }),
      ]);
      const plan = replay.plan;

      expect(sha256(sourceBytes)).toBe(SOURCE_PLAN_SHA256);
      expect(replay.outputSha256).toBe(ARTIFACT_SHA256);
      expect(plan.counts).toEqual({
        expectedRequestCount: 643,
        sourceTargetCount: 643,
      });
      expect(plan.targets).toHaveLength(643);
      expect(plan.targets.map(({ captureOrder }) => captureOrder))
        .toEqual(Array.from(
          { length: 643 },
          (_, index) => index + 1,
        ));
      expect(plan.independenceBoundary).toMatchObject({
        goldInput: false,
        machineOutcomeInput: false,
        patchInput: false,
        planTargetProjectionSha256:
          SOURCE_TARGET_PROJECTION_SHA256,
        semanticDecisionInput: false,
        sourceTargetProjectionSha256:
          SOURCE_TARGET_PROJECTION_SHA256,
        testInput: false,
      });
      expect(plan.registrationBoundary).toEqual({
        exploratoryAllTargetCountDiagnosticObserved: true,
        frozenBeforeCanonicalCapture: true,
        initialPlanV2TransportFailureObserved: true,
        preregisteredBeforeExploratoryDiagnostic: false,
      });
      expect(plan.rule).toEqual(
        C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY_POLICY,
      );
      expect(plan.rule).toMatchObject({
        oneLogicalRequestPerTarget: true,
        outcomeBlind: true,
        platformCommitCap: 250,
        transportContract: {
          maximumNetworkAttemptsPerTarget: 4,
          maximumRetryAfterMilliseconds: 60_000,
        },
      });
      expect(plan.queryContract).toMatchObject({
        policySha256: POLICY_SHA256,
        querySha256: QUERY_SHA256,
      });
      expect(sha256(
        C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
      )).toBe(QUERY_SHA256);
      expect(sha256(
        serializeC6LiveMultiLangNeighborCommitCountEligibilityQueryPolicy(),
      )).toBe(POLICY_SHA256);
      expect(plan.boundary).toMatchObject({
        acceptedEpisodeCount: 0,
        candidateManifestFrozen: false,
        codexRunReady: false,
        commitCountCaptureExecuted: false,
        machineQualifiedEpisodeCount: 0,
        semanticallyQualifiedEpisodeCount: 0,
      });
    });

    it("rejects changed chronology, policy, and target closure", async () => {
      const replay =
        await buildC6LiveMultiLangNeighborCommitCountEligibilityPlan({
          sourcePlanPath: SOURCE_PLAN_PATH,
        });
      const raw = JSON.parse(
        serializeC6LiveMultiLangNeighborCommitCountEligibilityPlan(
          replay.plan,
        ),
      ) as Record<string, unknown>;

      for (const mutate of [
        (value: Record<string, unknown>) => {
          const boundary = value.registrationBoundary as
            Record<string, unknown>;
          boundary.preregisteredBeforeExploratoryDiagnostic = true;
        },
        (value: Record<string, unknown>) => {
          const rule = value.rule as Record<string, unknown>;
          rule.platformCommitCap = 251;
        },
        (value: Record<string, unknown>) => {
          const targets = value.targets as unknown[];
          targets.pop();
        },
      ]) {
        const changed = structuredClone(raw);
        mutate(changed);
        expect(() =>
          parseC6LiveMultiLangNeighborCommitCountEligibilityPlan(
            `${JSON.stringify(changed, null, 2)}\n`,
          )
        ).toThrow();
      }
    });
  },
);

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
