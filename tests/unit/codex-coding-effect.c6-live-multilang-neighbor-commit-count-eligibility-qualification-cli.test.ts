import { describe, expect, it } from "bun:test";

import {
  parseC6LiveMultiLangNeighborCommitCountEligibilityQualificationCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-commit-count-eligibility-qualification";

const SHA = "a".repeat(64);

describe("C6 commit-count eligibility qualification CLI", () => {
  it("parses the exact canonical input hashes and paths", () => {
    expect(
      parseC6LiveMultiLangNeighborCommitCountEligibilityQualificationCliOptions([
        "--capture-root=/capture",
        "--census-qualification=/inputs/census.json",
        "--deep-capture-plan=/inputs/deep-plan.json",
        "--eligibility-plan=/inputs/eligibility-plan.json",
        `--expected-capture-asset-lock-sha256=${SHA}`,
        `--expected-capture-asset-root-sha256=${SHA}`,
        `--expected-capture-completion-sha256=${SHA}`,
        `--expected-census-qualification-sha256=${SHA}`,
        `--expected-deep-capture-plan-sha256=${SHA}`,
        `--expected-eligibility-plan-sha256=${SHA}`,
        "--output=/output/qualification.json",
      ]),
    ).toEqual({
      captureRoot: "/capture",
      censusQualification: "/inputs/census.json",
      deepCapturePlan: "/inputs/deep-plan.json",
      eligibilityPlan: "/inputs/eligibility-plan.json",
      expectedCaptureAssetLockSha256: SHA,
      expectedCaptureAssetRootSha256: SHA,
      expectedCaptureCompletionSha256: SHA,
      expectedCensusQualificationSha256: SHA,
      expectedDeepCapturePlanSha256: SHA,
      expectedEligibilityPlanSha256: SHA,
      output: "/output/qualification.json",
    });
  });

  it("rejects unknown and incomplete option sets", () => {
    expect(() =>
      parseC6LiveMultiLangNeighborCommitCountEligibilityQualificationCliOptions([
        "--unknown=value",
      ])
    ).toThrow("unknown");
    expect(() =>
      parseC6LiveMultiLangNeighborCommitCountEligibilityQualificationCliOptions(
        [],
      )
    ).toThrow("required exactly once");
  });
});
