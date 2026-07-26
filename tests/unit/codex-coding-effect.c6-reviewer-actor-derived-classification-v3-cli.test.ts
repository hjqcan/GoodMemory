import { describe, expect, it } from "bun:test";

import {
  parseC6ReviewerActorDerivedClassificationV3CliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-reviewer-actor-derived-classification-v3";

describe("C6 reviewer actor derived classification v3 CLI", () => {
  it("parses exactly the plan, raw root, and output paths", () => {
    expect(
      parseC6ReviewerActorDerivedClassificationV3CliOptions([
        "--actor-plan=/tmp/plan-v2.json",
        "--actor-root=/tmp/raw-v2",
        "--output=/tmp/classification-v3.json",
      ]),
    ).toEqual({
      actorPlan: "/tmp/plan-v2.json",
      actorRoot: "/tmp/raw-v2",
      output: "/tmp/classification-v3.json",
    });
  });

  it("rejects missing, duplicate, padded, and unknown options", () => {
    expect(() =>
      parseC6ReviewerActorDerivedClassificationV3CliOptions([
        "--actor-plan=/tmp/plan-v2.json",
        "--actor-root=/tmp/raw-v2",
      ])
    ).toThrow("--output is required");
    expect(() =>
      parseC6ReviewerActorDerivedClassificationV3CliOptions([
        "--actor-plan=/tmp/one.json",
        "--actor-plan=/tmp/two.json",
        "--actor-root=/tmp/raw-v2",
        "--output=/tmp/out.json",
      ])
    ).toThrow("cannot be specified more than once");
    expect(() =>
      parseC6ReviewerActorDerivedClassificationV3CliOptions([
        "--actor-plan= /tmp/plan-v2.json",
        "--actor-root=/tmp/raw-v2",
        "--output=/tmp/out.json",
      ])
    ).toThrow("must not be empty or padded");
    expect(() =>
      parseC6ReviewerActorDerivedClassificationV3CliOptions([
        "--actor-plan=/tmp/plan-v2.json",
        "--actor-root=/tmp/raw-v2",
        "--output=/tmp/out.json",
        "--review-outcomes=/tmp/forbidden.json",
      ])
    ).toThrow("unknown");
  });
});
