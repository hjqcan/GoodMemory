import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
  classifyC6ReviewerActorV2,
} from "../../scripts/codex-coding-effect/c6-reviewer-actor-policy-v2";
import {
  classifyC6ReviewerActorV3,
  C6_REVIEWER_ACTOR_POLICY_V3,
  serializeC6ReviewerActorPolicyV3,
} from "../../scripts/codex-coding-effect/c6-reviewer-actor-policy-v3";

describe("Codex coding-effect C6 reviewer actor policy v3", () => {
  it("adds only the case-insensitive -agent suffix to v2", () => {
    const newExclusion = {
      plannedLogin: "JoeStump-Agent",
      platformType: "User",
      responseLogin: "JOESTUMP-AGENT",
      status: 200 as const,
    };
    expect(classifyC6ReviewerActorV2(newExclusion)).toMatchObject({
      eligible: true,
      normalizedLogin: "joestump-agent",
    });
    expect(classifyC6ReviewerActorV3(newExclusion)).toEqual({
      eligible: false,
      normalizedLogin: "joestump-agent",
      reason: "automation-agent-suffix-excluded",
    });

    expect(classifyC6ReviewerActorV3({
      plannedLogin: "copilot-swe-agent",
      platformType: "User",
      responseLogin: "copilot-swe-agent",
      status: 200,
    })).toEqual({
      eligible: false,
      normalizedLogin: "copilot-swe-agent",
      reason: "known-automation-login",
    });
    expect(classifyC6ReviewerActorV3({
      plannedLogin: "human-agent-smith",
      platformType: "User",
      responseLogin: "human-agent-smith",
      status: 200,
    })).toEqual({
      eligible: true,
      normalizedLogin: "human-agent-smith",
      reason:
        "current-platform-user-no-known-automation-signal",
    });
  });

  it("inherits fail-closed v2 behavior and an exact source-policy binding", () => {
    expect(classifyC6ReviewerActorV3({
      plannedLogin: "missing-agent",
      platformType: null,
      responseLogin: null,
      status: 404,
    }).reason).toBe("platform-actor-unresolved");
    expect(classifyC6ReviewerActorV3({
      plannedLogin: "service-agent",
      platformType: "Organization",
      responseLogin: "service-agent",
      status: 200,
    }).reason).toBe("platform-actor-not-user");
    expect(
      C6_REVIEWER_ACTOR_POLICY_V3.actorEligibility
        .automationLoginRuleV3,
    ).toEqual({
      suffixCaseInsensitive: "-agent",
    });
    expect(C6_REVIEWER_ACTOR_POLICY_V3.sourcePolicy).toEqual({
      policyId: "reviewer-platform-actor-eligibility-v2",
      schemaVersion: 2,
      sha256:
        "c243571bc95c44494dca68606ba772c26a7b640d1c2bbe60fc1818603efc0e44",
    });
    expect(C6_REVIEWER_ACTOR_POLICY_V3.chronology).toEqual({
      adaptiveAfterCompleteActorCapture: true,
      commitAncestryProven: false,
      preregisteredBeforeActorCapture: false,
      selectionExecuted: false,
    });
  });

  it("serializes the exact canonical policy definition", () => {
    const serialized = serializeC6ReviewerActorPolicyV3();
    expect(serialized).toBe(
      `${JSON.stringify(C6_REVIEWER_ACTOR_POLICY_V3, null, 2)}\n`,
    );
    expect(serialized).toContain(
      '"policyId": "reviewer-platform-actor-eligibility-v3"',
    );
    expect(Buffer.byteLength(serialized)).toBe(1_420);
    expect(hash(serialized)).toBe(
      "a8769b437d8515c9f489639aa90fa4fb3230647cc4508bafaf29d1e970bc2899",
    );
  });
});

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
