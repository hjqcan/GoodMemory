import {
  classifyC6ReviewerActorV2,
  C6_REVIEWER_ACTOR_POLICY_V2,
} from "./c6-reviewer-actor-policy-v2";
import type {
  C6ReviewerActorReasonV2,
} from "./c6-reviewer-actor-policy-v2";

const V2_POLICY_SHA256 =
  "c243571bc95c44494dca68606ba772c26a7b640d1c2bbe60fc1818603efc0e44";

export const C6_REVIEWER_ACTOR_POLICY_V3 = {
  actorEligibility: {
    automationLoginRuleV1:
      C6_REVIEWER_ACTOR_POLICY_V2.actorEligibility
        .automationLoginRuleV1,
    automationLoginRuleV2:
      C6_REVIEWER_ACTOR_POLICY_V2.actorEligibility
        .automationLoginRuleV2,
    automationLoginRuleV3: {
      suffixCaseInsensitive: "-agent",
    },
    platformType:
      C6_REVIEWER_ACTOR_POLICY_V2.actorEligibility.platformType,
    unresolvedStatus:
      C6_REVIEWER_ACTOR_POLICY_V2.actorEligibility.unresolvedStatus,
  },
  boundary: C6_REVIEWER_ACTOR_POLICY_V2.boundary,
  chronology: {
    adaptiveAfterCompleteActorCapture: true,
    commitAncestryProven: false,
    preregisteredBeforeActorCapture: false,
    selectionExecuted: false,
  },
  inputClosure:
    C6_REVIEWER_ACTOR_POLICY_V2.inputClosure,
  policyId: "reviewer-platform-actor-eligibility-v3",
  responseIdentity:
    C6_REVIEWER_ACTOR_POLICY_V2.responseIdentity,
  schemaVersion: 3,
  sourcePolicy: {
    policyId: C6_REVIEWER_ACTOR_POLICY_V2.policyId,
    schemaVersion: C6_REVIEWER_ACTOR_POLICY_V2.schemaVersion,
    sha256: V2_POLICY_SHA256,
  },
} as const;

export type C6ReviewerActorReasonV3 =
  | C6ReviewerActorReasonV2
  | "automation-agent-suffix-excluded";

export interface C6ReviewerActorClassificationV3 {
  eligible: boolean;
  normalizedLogin: string;
  reason: C6ReviewerActorReasonV3;
}

export function classifyC6ReviewerActorV3(input: {
  plannedLogin: string;
  platformType: string | null;
  responseLogin: string | null;
  status: 200 | 404;
}): C6ReviewerActorClassificationV3 {
  const v2 = classifyC6ReviewerActorV2(input);
  if (!v2.eligible) {
    return v2;
  }
  if (
    v2.normalizedLogin.endsWith(
      C6_REVIEWER_ACTOR_POLICY_V3.actorEligibility
        .automationLoginRuleV3.suffixCaseInsensitive,
    )
  ) {
    return {
      eligible: false,
      normalizedLogin: v2.normalizedLogin,
      reason: "automation-agent-suffix-excluded",
    };
  }
  return v2;
}

export function serializeC6ReviewerActorPolicyV3(): string {
  return `${JSON.stringify(C6_REVIEWER_ACTOR_POLICY_V3, null, 2)}\n`;
}
