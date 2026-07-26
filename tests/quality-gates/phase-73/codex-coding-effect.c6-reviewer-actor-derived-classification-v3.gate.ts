import { join, resolve } from "node:path";

import { describe, expect, it, setDefaultTimeout } from "bun:test";

import {
  runC6ReviewerActorDerivedClassificationV3Gate,
} from "../../../scripts/codex-coding-effect/c6-reviewer-actor-derived-classification-v3-gate";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_POOL_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool",
);
const ACTOR_PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "neighbor-reviewer-actor-plan-v2.json",
);
const CLASSIFICATION_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "neighbor-reviewer-actor-derived-classification-v3.json",
);
const ACTOR_ROOT = requiredEnvironmentPath(
  "GOODMEMORY_TEST_C6_LIVE_MULTILANG_NEIGHBOR_ACTOR_V2_ROOT",
);

setDefaultTimeout(300_000);

describe(
  "Codex coding-effect C6 union-wide reviewer actor classification v3 gate",
  () => {
    it("rebuilds the exact 507-row classification from the external raw root", async () => {
      expect(
        await runC6ReviewerActorDerivedClassificationV3Gate({
          actorPlanPath: ACTOR_PLAN_PATH,
          actorRoot: ACTOR_ROOT,
          classificationPath: CLASSIFICATION_PATH,
        }),
      ).toEqual({
        acceptedEpisodeCount: 0,
        codexRunReady: false,
        counts: {
          actorCount: 507,
          newlyExcludedActorCount: 1,
          resolvedActorCount: 500,
          unresolvedActorCount: 7,
          v2EligibleActorCount: 487,
          v2IneligibleActorCount: 20,
          v3EligibleActorCount: 486,
          v3IneligibleActorCount: 21,
        },
        independentReviewCompleted: false,
        outputBytes: 225_600,
        outputSha256:
          "7b8a812b7740ce2703eee470b01043fce8f8a64a120dca5ebc11f8226920696b",
        passed: true,
        selectionExecuted: false,
      });
    });
  },
);

function requiredEnvironmentPath(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `C6 reviewer actor classification v3 gate missing ${name}`,
    );
  }
  return value;
}
