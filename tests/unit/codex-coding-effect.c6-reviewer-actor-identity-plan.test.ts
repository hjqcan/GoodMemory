import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
  deriveC6ReviewerActorIdentityPlan,
} from "../../scripts/codex-coding-effect/c6-reviewer-actor-identity-plan";

describe("Codex coding-effect C6 reviewer actor identity plan", () => {
  it("freezes every observed review author once in normalized lexical order", () => {
    const plan = deriveC6ReviewerActorIdentityPlan({
      authors: [
        "Reviewer-Z",
        "reviewer-a",
        "REVIEWER-Z",
        "service[bot]",
      ],
      graphqlRootSha256: "1".repeat(64),
      qualificationBytes: 123,
      qualificationPath: "qualification.json",
      qualificationSha256: "2".repeat(64),
      sourceTargetCount: 7,
    });

    expect(plan.targets.map((target) => target.login)).toEqual([
      "reviewer-a",
      "reviewer-z",
      "service[bot]",
    ]);
    expect(plan.targets.map((target) => target.captureOrder)).toEqual([
      1,
      2,
      3,
    ]);
    expect(plan.counts).toEqual({
      sourceReviewReferenceCount: 4,
      sourceTargetCount: 7,
      uniqueActorCount: 3,
    });
    expect(plan.targets[0]!.captureDirectory).toBe(
      `actor-${sha256("reviewer-a")}`,
    );
    expect(plan.boundary).toMatchObject({
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      candidateManifestFrozen: false,
      codexRunReady: false,
    });
  });

  it("rejects malformed authors and binds the target projection", () => {
    expect(() =>
      deriveC6ReviewerActorIdentityPlan({
        authors: [" padded "],
        graphqlRootSha256: "1".repeat(64),
        qualificationBytes: 123,
        qualificationPath: "qualification.json",
        qualificationSha256: "2".repeat(64),
        sourceTargetCount: 1,
      })
    ).toThrow("invalid author");

    const plan = deriveC6ReviewerActorIdentityPlan({
      authors: ["reviewer"],
      graphqlRootSha256: "1".repeat(64),
      qualificationBytes: 123,
      qualificationPath: "qualification.json",
      qualificationSha256: "2".repeat(64),
      sourceTargetCount: 1,
    });
    expect(plan.independenceBoundary.targetProjectionSha256).toBe(
      sha256(JSON.stringify(plan.targets)),
    );
  });
});

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
