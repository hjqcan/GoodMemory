import { describe, expect, it } from "bun:test";
import type { LanguageContentAnalysis } from "../../../src/language";
import { containsSensitiveCredentialFromAnalysis } from "../../../src/language/sensitive";

const NON_SENSITIVE_ANALYSIS: LanguageContentAnalysis = {
  assistantAcknowledgement: false,
  assistantContinuity: false,
  blockerFact: false,
  correctionCue: false,
  durableCue: false,
  factPolarity: "unknown",
  feedbackKind: "do",
  focusFact: false,
  openLoopFact: false,
  personalEvidence: false,
  preferenceEvidence: false,
  projectStateFact: false,
  roleFact: false,
  sensitiveCredential: false,
  unresolved: false,
};

describe("language-sensitive analysis reuse", () => {
  it("combines universal tokens with an existing pack analysis", () => {
    expect(
      containsSensitiveCredentialFromAnalysis(
        "ordinary content",
        { ...NON_SENSITIVE_ANALYSIS, sensitiveCredential: true },
      ),
    ).toBe(true);
    expect(
      containsSensitiveCredentialFromAnalysis(
        "token sk-abcdefghijklmnopqrstuvwx",
        NON_SENSITIVE_ANALYSIS,
      ),
    ).toBe(true);
    expect(
      containsSensitiveCredentialFromAnalysis(
        "ordinary content",
        NON_SENSITIVE_ANALYSIS,
      ),
    ).toBe(false);
  });
});
