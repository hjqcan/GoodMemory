import { describe, expect, it } from "bun:test";

import {
  classifyC6ReviewerActor,
  C6_REVIEWER_ACTOR_POLICY_V1,
  serializeC6ReviewerActorPolicy,
} from "../../scripts/codex-coding-effect/c6-reviewer-actor-policy";

describe("Codex coding-effect C6 reviewer actor policy", () => {
  it("accepts only a resolved platform User without an automation signature", () => {
    expect(classifyC6ReviewerActor({
      plannedLogin: "Human-Reviewer",
      platformType: "User",
      responseLogin: "human-reviewer",
      status: 200,
    })).toEqual({
      eligible: true,
      normalizedLogin: "human-reviewer",
      reason: "eligible-platform-user",
    });
  });

  it("rejects unresolved, non-User, and known automation actors", () => {
    expect(classifyC6ReviewerActor({
      plannedLogin: "missing-actor",
      platformType: null,
      responseLogin: null,
      status: 404,
    }).reason).toBe("platform-actor-unresolved");
    expect(classifyC6ReviewerActor({
      plannedLogin: "CodeRabbitAI",
      platformType: "Organization",
      responseLogin: "coderabbitai",
      status: 200,
    }).reason).toBe("platform-actor-not-user");
    expect(classifyC6ReviewerActor({
      plannedLogin: "copilot-swe-agent",
      platformType: "User",
      responseLogin: "copilot-swe-agent",
      status: 200,
    }).reason).toBe("known-automation-login");
    expect(classifyC6ReviewerActor({
      plannedLogin: "service[bot]",
      platformType: "Bot",
      responseLogin: "service[bot]",
      status: 200,
    }).reason).toBe("platform-actor-not-user");
  });

  it("fails closed on response identity drift and freezes claim boundaries", () => {
    expect(() =>
      classifyC6ReviewerActor({
        plannedLogin: "reviewer-one",
        platformType: "User",
        responseLogin: "reviewer-two",
        status: 200,
      })
    ).toThrow("actor identity mismatch");
    expect(C6_REVIEWER_ACTOR_POLICY_V1.boundary).toEqual({
      automationExclusionComplete: false,
      eventTimeActorTypeProven: false,
      humanReviewerIdentityProven: false,
      platformActorTypeCaptured: true,
    });
    expect(serializeC6ReviewerActorPolicy()).toContain(
      "all-broad-target-review-authors-before-actor-filtering",
    );
  });
});
