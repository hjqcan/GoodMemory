import { expect, test } from "bun:test";

import {
  parseC6RestIdentitySupplementPlanCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-rest-identity-supplement-plan";

test("C6 REST identity supplement plan CLI requires the frozen tuple", () => {
  expect(parseC6RestIdentitySupplementPlanCliOptions([
    `--expected-capture-plan-sha256=${"a".repeat(64)}`,
    `--expected-qualification-sha256=${"b".repeat(64)}`,
    "--capture-plan=capture-plan.json",
    "--qualification=qualification.json",
    "--output=supplement-plan.json",
  ])).toEqual({
    capturePlan: "capture-plan.json",
    expectedCapturePlanSha256: "a".repeat(64),
    expectedQualificationSha256: "b".repeat(64),
    output: "supplement-plan.json",
    qualification: "qualification.json",
  });
  expect(() => parseC6RestIdentitySupplementPlanCliOptions([]))
    .toThrow("--expected-capture-plan-sha256 is required");
  expect(() => parseC6RestIdentitySupplementPlanCliOptions([
    "--unknown=value",
  ])).toThrow("unknown C6 REST identity supplement option");
});
