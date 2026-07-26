import { describe, expect, it } from "bun:test";

import {
  parseC6SourceV3SimplePriorRepositoryIdentityCliOptions,
  runC6SourceV3SimplePriorRepositoryIdentityCommand,
} from "../../scripts/capture-codex-coding-effect-c6-source-v3-simple-prior-repository-identity";

const ARGS = [
  "--output-root=/tmp/c6-source-v3-prior",
  "--plan=/tmp/plan.json",
  "--protocol=/tmp/protocol.json",
  "--source-universe=/tmp/source.json",
  "--token-env=GITHUB_TOKEN",
] as const;

describe("C6 source-v3-simple prior identity CLI", () => {
  it("parses only frozen input paths, output root, and token env", () => {
    expect(
      parseC6SourceV3SimplePriorRepositoryIdentityCliOptions(
        ARGS,
      ),
    ).toEqual({
      outputRoot: "/tmp/c6-source-v3-prior",
      plan: "/tmp/plan.json",
      protocol: "/tmp/protocol.json",
      sourceUniverse: "/tmp/source.json",
      tokenEnv: "GITHUB_TOKEN",
    });
    expect(() =>
      parseC6SourceV3SimplePriorRepositoryIdentityCliOptions([
        ...ARGS,
        "--endpoint=https://example.invalid/graphql",
      ])
    ).toThrow("unknown");
    expect(() =>
      parseC6SourceV3SimplePriorRepositoryIdentityCliOptions([
        ...ARGS,
        "--plan=/tmp/duplicate.json",
      ])
    ).toThrow("cannot be specified more than once");
  });

  it("fails before capture when the named token env is absent", async () => {
    await expect(
      runC6SourceV3SimplePriorRepositoryIdentityCommand(
        ARGS,
        {},
      ),
    ).rejects.toThrow("GITHUB_TOKEN is required");
  });
});
