import { describe, expect, it } from "bun:test";

import {
  parseC6ReviewerActorDerivedClassificationCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-reviewer-actor-derived-classification";

describe("C6 reviewer actor derived classification CLI", () => {
  it("parses the three required paths", () => {
    expect(
      parseC6ReviewerActorDerivedClassificationCliOptions([
        "--actor-plan=/tmp/plan.json",
        "--actor-root=/tmp/root",
        "--output=/tmp/classification.json",
      ]),
    ).toEqual({
      actorPlan: "/tmp/plan.json",
      actorRoot: "/tmp/root",
      output: "/tmp/classification.json",
    });
  });

  it("rejects missing, duplicate, unknown, and padded options", () => {
    expect(() =>
      parseC6ReviewerActorDerivedClassificationCliOptions([
        "--actor-plan=/tmp/plan.json",
        "--actor-root=/tmp/root",
      ])
    ).toThrow("--output is required");
    expect(() =>
      parseC6ReviewerActorDerivedClassificationCliOptions([
        "--actor-plan=/tmp/one.json",
        "--actor-plan=/tmp/two.json",
        "--actor-root=/tmp/root",
        "--output=/tmp/out.json",
      ])
    ).toThrow("cannot be specified more than once");
    expect(() =>
      parseC6ReviewerActorDerivedClassificationCliOptions([
        "--actor-plan=/tmp/plan.json",
        "--actor-root=/tmp/root",
        "--output=/tmp/out.json",
        "--selection=/tmp/forbidden.json",
      ])
    ).toThrow("unknown");
    expect(() =>
      parseC6ReviewerActorDerivedClassificationCliOptions([
        "--actor-plan= /tmp/plan.json",
        "--actor-root=/tmp/root",
        "--output=/tmp/out.json",
      ])
    ).toThrow("must not be empty or padded");
  });
});
