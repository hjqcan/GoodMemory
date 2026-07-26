import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
  classifyC6ReviewerActor,
  serializeC6ReviewerActorPolicy,
} from "../../scripts/codex-coding-effect/c6-reviewer-actor-policy";
import {
  classifyC6ReviewerActorV2,
  C6_REVIEWER_ACTOR_POLICY_V2,
  serializeC6ReviewerActorPolicyV2,
} from "../../scripts/codex-coding-effect/c6-reviewer-actor-policy-v2";

describe("Codex coding-effect C6 reviewer actor policy v2", () => {
  it("preserves v1 and excludes the five outcome-blind false positives", () => {
    const falsePositives = [
      "cubic-dev-ai",
      "esphbot",
      "gemini-code-assist",
      "greptile-apps",
      "mentatbot",
    ];

    for (const login of falsePositives) {
      const input = {
        plannedLogin: login,
        platformType: "User",
        responseLogin: login,
        status: 200 as const,
      };
      expect(classifyC6ReviewerActor(input).eligible).toBe(true);
      expect(classifyC6ReviewerActorV2(input)).toMatchObject({
        eligible: false,
        normalizedLogin: login,
        reason: "automation-style-login-excluded",
      });
    }
    expect(hash(serializeC6ReviewerActorPolicy())).toBe(
      "ca0014e5e6d47dc63f490b49bff6835b9d5ed99e69b3eb8d8ddf4266edc8643f",
    );
  });

  it("uses a bot suffix plus three exact additions without broad substring rules", () => {
    expect(
      C6_REVIEWER_ACTOR_POLICY_V2.actorEligibility
        .automationLoginRuleV2,
    ).toEqual({
      exactCaseInsensitive: [
        "cubic-dev-ai",
        "gemini-code-assist",
        "greptile-apps",
      ],
      suffixCaseInsensitive: "bot",
    });

    for (
      const login of [
        "autocarl",
        "nazarhussain",
        "nflaig",
        "pappz",
        "rafael-rosa-knowcode",
        "wemeetagain",
      ]
    ) {
      expect(classifyC6ReviewerActorV2({
        plannedLogin: login,
        platformType: "User",
        responseLogin: login,
        status: 200,
      })).toEqual({
        eligible: true,
        normalizedLogin: login,
        reason:
          "current-platform-user-no-known-automation-signal",
      });
    }
  });

  it("inherits fail-closed v1 behavior and freezes narrow claim boundaries", () => {
    expect(classifyC6ReviewerActorV2({
      plannedLogin: "missing-actor",
      platformType: null,
      responseLogin: null,
      status: 404,
    }).reason).toBe("platform-actor-unresolved");
    expect(classifyC6ReviewerActorV2({
      plannedLogin: "service-account",
      platformType: "Organization",
      responseLogin: "service-account",
      status: 200,
    }).reason).toBe("platform-actor-not-user");
    expect(() =>
      classifyC6ReviewerActorV2({
        plannedLogin: "reviewer-one",
        platformType: "User",
        responseLogin: "reviewer-two",
        status: 200,
      })
    ).toThrow("actor identity mismatch");
    expect(C6_REVIEWER_ACTOR_POLICY_V2.boundary).toEqual({
      automationExclusionComplete: false,
      eventTimeActorTypeProven: false,
      humanReviewerIdentityProven: false,
      platformActorTypeCaptured: true,
    });
    expect(C6_REVIEWER_ACTOR_POLICY_V2.chronology).toEqual({
      adaptiveAfterActorCapture: true,
      commitAncestryProven: false,
      preregisteredBeforeActorCapture: false,
      selectionExecuted: false,
    });
    expect(serializeC6ReviewerActorPolicyV2()).toContain(
      '"policyId": "reviewer-platform-actor-eligibility-v2"',
    );
    expect(hash(serializeC6ReviewerActorPolicyV2())).toBe(
      "c243571bc95c44494dca68606ba772c26a7b640d1c2bbe60fc1818603efc0e44",
    );
  });
});

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
