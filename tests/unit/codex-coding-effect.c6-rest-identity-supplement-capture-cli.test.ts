import { expect, test } from "bun:test";

import {
  parseC6RestIdentitySupplementCaptureCliOptions,
} from "../../scripts/capture-codex-coding-effect-c6-rest-identity-supplement";

test("C6 REST identity supplement capture CLI requires explicit frozen inputs", () => {
  expect(parseC6RestIdentitySupplementCaptureCliOptions([
    `--expected-plan-sha256=${"a".repeat(64)}`,
    "--plan=plan.json",
    "--output-root=/tmp/capture",
    "--token-env=GITHUB_TOKEN",
  ])).toEqual({
    expectedPlanSha256: "a".repeat(64),
    outputRoot: "/tmp/capture",
    plan: "plan.json",
    tokenEnv: "GITHUB_TOKEN",
  });
  expect(() => parseC6RestIdentitySupplementCaptureCliOptions([]))
    .toThrow("--expected-plan-sha256 is required");
  expect(() => parseC6RestIdentitySupplementCaptureCliOptions([
    `--expected-plan-sha256=${"a".repeat(64)}`,
    "--plan=plan.json",
    "--output-root=/tmp/capture",
    "--token-env=invalid-name",
  ])).toThrow("uppercase environment variable");
});
