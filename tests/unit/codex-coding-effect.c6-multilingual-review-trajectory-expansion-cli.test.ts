import { describe, expect, it } from "bun:test";

import {
  parseC6MultilingualReviewTrajectoryExpansionCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-multilingual-review-trajectory-expansion";

const SHA = "a".repeat(64);

describe("C6 multilingual review-trajectory expansion CLI", () => {
  it("parses the complete hash-bound input closure", () => {
    expect(
      parseC6MultilingualReviewTrajectoryExpansionCliOptions([
        "--capture-plan=plan.json",
        `--expected-capture-plan-sha256=${SHA}`,
        `--expected-graphql-root-sha256=${SHA}`,
        `--expected-prior-frame-sha256=${SHA}`,
        "--graphql-root=graphql",
        "--prior-frame=frame.json",
        "--output=output.json",
      ]),
    ).toEqual({
      capturePlan: "plan.json",
      expectedCapturePlanSha256: SHA,
      expectedGraphqlRootSha256: SHA,
      expectedPriorFrameSha256: SHA,
      graphqlRoot: "graphql",
      output: "output.json",
      priorFrame: "frame.json",
    });
  });

  it("rejects missing, duplicate, padded, unknown, and malformed options", () => {
    const valid = [
      "--capture-plan=plan.json",
      `--expected-capture-plan-sha256=${SHA}`,
      `--expected-graphql-root-sha256=${SHA}`,
      `--expected-prior-frame-sha256=${SHA}`,
      "--graphql-root=graphql",
      "--prior-frame=frame.json",
      "--output=output.json",
    ];
    expect(() =>
      parseC6MultilingualReviewTrajectoryExpansionCliOptions(
        valid.slice(1),
      )
    ).toThrow();
    expect(() =>
      parseC6MultilingualReviewTrajectoryExpansionCliOptions([
        ...valid,
        "--output=other.json",
      ])
    ).toThrow();
    expect(() =>
      parseC6MultilingualReviewTrajectoryExpansionCliOptions([
        ...valid.slice(0, -1),
        "--output= output.json",
      ])
    ).toThrow();
    expect(() =>
      parseC6MultilingualReviewTrajectoryExpansionCliOptions([
        ...valid,
        "--unknown=value",
      ])
    ).toThrow();
    expect(() =>
      parseC6MultilingualReviewTrajectoryExpansionCliOptions([
        ...valid.slice(0, 1),
        "--expected-capture-plan-sha256=bad",
        ...valid.slice(2),
      ])
    ).toThrow();
  });
});
