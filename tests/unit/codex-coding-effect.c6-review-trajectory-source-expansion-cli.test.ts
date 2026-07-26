import { describe, expect, it } from "bun:test";

import {
  parseC6ReviewTrajectorySourceExpansionCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-review-trajectory-source-expansion";

describe("Codex coding-effect C6 source expansion snapshot CLI", () => {
  it("requires explicit frozen inputs and output", () => {
    const args = [
      "--inventory=/tmp/inventory.json",
      `--expected-inventory-sha256=${"a".repeat(64)}`,
      "--legacy-frame=/tmp/frame.json",
      `--expected-legacy-frame-sha256=${"b".repeat(64)}`,
      "--graphql-capture-root=/tmp/graphql",
      "--output=/tmp/expansion.json",
    ];

    expect(
      parseC6ReviewTrajectorySourceExpansionCliOptions(args),
    ).toEqual({
      expectedInventorySha256: "a".repeat(64),
      expectedLegacyFrameSha256: "b".repeat(64),
      graphqlCaptureRoot: "/tmp/graphql",
      inventory: "/tmp/inventory.json",
      legacyFrame: "/tmp/frame.json",
      output: "/tmp/expansion.json",
    });
    expect(() =>
      parseC6ReviewTrajectorySourceExpansionCliOptions(
        args.filter((argument) => !argument.startsWith("--output=")),
      )
    ).toThrow("--output is required exactly once");
    expect(() =>
      parseC6ReviewTrajectorySourceExpansionCliOptions([
        ...args,
        "--ledger=/tmp/semantic-ledger.json",
      ])
    ).toThrow("unknown C6 source expansion option --ledger");
  });
});
