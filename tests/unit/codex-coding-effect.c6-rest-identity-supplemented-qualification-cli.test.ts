import { expect, test } from "bun:test";

import {
  parseC6RestIdentitySupplementedQualificationCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-rest-identity-supplemented-qualification";

test("C6 supplemented qualification CLI binds every frozen root", () => {
  expect(parseC6RestIdentitySupplementedQualificationCliOptions([
    `--expected-graphql-root-sha256=${"a".repeat(64)}`,
    `--expected-original-qualification-sha256=${"b".repeat(64)}`,
    `--expected-supplement-plan-sha256=${"c".repeat(64)}`,
    `--expected-supplement-root-sha256=${"d".repeat(64)}`,
    "--graphql-root=/tmp/graphql",
    "--original-qualification=qualification-v1.json",
    "--supplement-plan=plan.json",
    "--supplement-root=/tmp/supplement",
    "--output=qualification-v2.json",
  ])).toMatchObject({
    expectedGraphqlRootSha256: "a".repeat(64),
    expectedOriginalQualificationSha256: "b".repeat(64),
    expectedSupplementPlanSha256: "c".repeat(64),
    expectedSupplementRootSha256: "d".repeat(64),
    output: "qualification-v2.json",
  });
  expect(() => parseC6RestIdentitySupplementedQualificationCliOptions([]))
    .toThrow("--expected-graphql-root-sha256 is required");
});
