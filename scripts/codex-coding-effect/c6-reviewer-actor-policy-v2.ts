import {
  classifyC6ReviewerActor,
  C6_REVIEWER_ACTOR_POLICY_V1,
} from "./c6-reviewer-actor-policy";

const V1_POLICY_SHA256 =
  "ca0014e5e6d47dc63f490b49bff6835b9d5ed99e69b3eb8d8ddf4266edc8643f";

export const C6_REVIEWER_ACTOR_POLICY_V2 = {
  actorEligibility: {
    automationLoginRuleV1:
      C6_REVIEWER_ACTOR_POLICY_V1.actorEligibility
        .automationLoginRule,
    automationLoginRuleV2: {
      exactCaseInsensitive: [
        "cubic-dev-ai",
        "gemini-code-assist",
        "greptile-apps",
      ],
      suffixCaseInsensitive: "bot",
    },
    platformType:
      C6_REVIEWER_ACTOR_POLICY_V1.actorEligibility.platformType,
    unresolvedStatus:
      C6_REVIEWER_ACTOR_POLICY_V1.actorEligibility.unresolvedStatus,
  },
  boundary: {
    automationExclusionComplete: false,
    eventTimeActorTypeProven: false,
    humanReviewerIdentityProven: false,
    platformActorTypeCaptured: true,
  },
  chronology: {
    adaptiveAfterActorCapture: true,
    commitAncestryProven: false,
    preregisteredBeforeActorCapture: false,
    selectionExecuted: false,
  },
  inputClosure:
    "all-frozen-actor-logins-and-current-platform-types-before-selection",
  policyId: "reviewer-platform-actor-eligibility-v2",
  responseIdentity: "case-insensitive-login-exact-match",
  schemaVersion: 2,
  sourcePolicy: {
    policyId: C6_REVIEWER_ACTOR_POLICY_V1.policyId,
    schemaVersion: C6_REVIEWER_ACTOR_POLICY_V1.schemaVersion,
    sha256: V1_POLICY_SHA256,
  },
} as const;

export type C6ReviewerActorReasonV2 =
  | "automation-style-login-excluded"
  | "current-platform-user-no-known-automation-signal"
  | "known-automation-login"
  | "platform-actor-not-user"
  | "platform-actor-unresolved";

export interface C6ReviewerActorClassificationV2 {
  eligible: boolean;
  normalizedLogin: string;
  reason: C6ReviewerActorReasonV2;
}

export function classifyC6ReviewerActorV2(input: {
  plannedLogin: string;
  platformType: string | null;
  responseLogin: string | null;
  status: 200 | 404;
}): C6ReviewerActorClassificationV2 {
  const v1 = classifyC6ReviewerActor(input);
  if (!v1.eligible) {
    if (v1.reason === "eligible-platform-user") {
      throw new Error(
        "C6 reviewer actor v1 classification is inconsistent",
      );
    }
    return {
      eligible: false,
      normalizedLogin: v1.normalizedLogin,
      reason: v1.reason,
    };
  }
  if (hasV2AutomationLoginSignature(v1.normalizedLogin)) {
    return {
      eligible: false,
      normalizedLogin: v1.normalizedLogin,
      reason: "automation-style-login-excluded",
    };
  }
  return {
    eligible: true,
    normalizedLogin: v1.normalizedLogin,
    reason:
      "current-platform-user-no-known-automation-signal",
  };
}

export function serializeC6ReviewerActorPolicyV2(): string {
  return `${JSON.stringify(C6_REVIEWER_ACTOR_POLICY_V2, null, 2)}\n`;
}

function hasV2AutomationLoginSignature(login: string): boolean {
  const rule =
    C6_REVIEWER_ACTOR_POLICY_V2.actorEligibility
      .automationLoginRuleV2;
  return login.endsWith(rule.suffixCaseInsensitive) ||
    rule.exactCaseInsensitive.some((value) => value === login);
}
