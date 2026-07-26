export const C6_REVIEWER_ACTOR_POLICY_V1 = {
  actorEligibility: {
    automationLoginRule: {
      containsCaseInsensitive: [
        "coderabbit",
        "copilot",
        "cursor",
      ],
      exactCaseInsensitive: [
        "github-actions",
        "github-advanced-security",
      ],
      suffixCaseInsensitive: "[bot]",
    },
    platformType: "User",
    unresolvedStatus: 404,
  },
  boundary: {
    automationExclusionComplete: false,
    eventTimeActorTypeProven: false,
    humanReviewerIdentityProven: false,
    platformActorTypeCaptured: true,
  },
  inputClosure:
    "all-broad-target-review-authors-before-actor-filtering",
  policyId: "reviewer-platform-actor-eligibility-v1",
  responseIdentity: "case-insensitive-login-exact-match",
  schemaVersion: 1,
} as const;

export type C6ReviewerActorReason =
  | "eligible-platform-user"
  | "known-automation-login"
  | "platform-actor-not-user"
  | "platform-actor-unresolved";

export interface C6ReviewerActorClassification {
  eligible: boolean;
  normalizedLogin: string;
  reason: C6ReviewerActorReason;
}

export function classifyC6ReviewerActor(input: {
  plannedLogin: string;
  platformType: string | null;
  responseLogin: string | null;
  status: 200 | 404;
}): C6ReviewerActorClassification {
  const plannedLogin = normalizeLogin(input.plannedLogin);
  if (input.status === 404) {
    if (
      input.platformType !== null ||
      input.responseLogin !== null
    ) {
      throw new Error(
        "C6 reviewer actor unresolved response contains an identity",
      );
    }
    return {
      eligible: false,
      normalizedLogin: plannedLogin,
      reason: "platform-actor-unresolved",
    };
  }
  if (
    input.platformType === null ||
    input.responseLogin === null ||
    normalizeLogin(input.responseLogin) !== plannedLogin
  ) {
    throw new Error("C6 reviewer actor identity mismatch");
  }
  if (
    input.platformType !==
      C6_REVIEWER_ACTOR_POLICY_V1.actorEligibility.platformType
  ) {
    return {
      eligible: false,
      normalizedLogin: plannedLogin,
      reason: "platform-actor-not-user",
    };
  }
  if (hasAutomationLoginSignature(plannedLogin)) {
    return {
      eligible: false,
      normalizedLogin: plannedLogin,
      reason: "known-automation-login",
    };
  }
  return {
    eligible: true,
    normalizedLogin: plannedLogin,
    reason: "eligible-platform-user",
  };
}

export function serializeC6ReviewerActorPolicy(): string {
  return `${JSON.stringify(C6_REVIEWER_ACTOR_POLICY_V1, null, 2)}\n`;
}

function hasAutomationLoginSignature(login: string): boolean {
  const rule =
    C6_REVIEWER_ACTOR_POLICY_V1.actorEligibility.automationLoginRule;
  return login.endsWith(rule.suffixCaseInsensitive) ||
    rule.exactCaseInsensitive.some((value) => login === value) ||
    rule.containsCaseInsensitive.some((value) => login.includes(value));
}

function normalizeLogin(value: string): string {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    /[/\s]/u.test(value)
  ) {
    throw new Error(`C6 reviewer actor invalid login ${value}`);
  }
  return value.toLowerCase();
}
