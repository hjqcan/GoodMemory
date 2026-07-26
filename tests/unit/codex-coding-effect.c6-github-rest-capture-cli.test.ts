import { describe, expect, it } from "bun:test";

import {
  parseC6GitHubRestCaptureCliOptions,
  runC6GitHubRestCaptureCli,
} from "../../scripts/capture-codex-coding-effect-c6-github-rest";

describe("Codex coding-effect C6 GitHub REST capture CLI", () => {
  it("parses one explicit capture target and canonicalizes issue numbers", () => {
    expect(parseC6GitHubRestCaptureCliOptions([
      "--owner=Example",
      "--repo=Project",
      "--pull=7",
      "--resolved-issues=202,101",
      "--output-dir=/tmp/c6-capture",
    ])).toEqual({
      outputDirectory: "/tmp/c6-capture",
      owner: "Example",
      pullNumber: 7,
      repository: "Project",
      resolvedIssueNumbers: [101, 202],
    });

    expect(() =>
      parseC6GitHubRestCaptureCliOptions([
        "--owner=Example",
        "--repo=Project",
        "--pull=7",
        "--resolved-issues=101,101",
        "--output-dir=/tmp/c6-capture",
      ])
    ).toThrow("resolved issue numbers must be unique");
    expect(() =>
      parseC6GitHubRestCaptureCliOptions([
        "--owner=Example",
        "--repo=Project",
        "--pull=7",
        "--resolved-issues=7",
        "--output-dir=/tmp/c6-capture",
      ])
    ).toThrow("resolved issue number must differ from the pull number");
  });

  it("reads the bearer token only from GITHUB_TOKEN and never returns it", async () => {
    const token = "cli-token-must-stay-secret";
    let receivedToken: string | undefined;
    const result = await runC6GitHubRestCaptureCli([
      "--owner=Example",
      "--repo=Project",
      "--pull=7",
      "--resolved-issues=101",
      "--output-dir=/tmp/c6-capture",
    ], {
      capture: async (input) => {
        receivedToken = input.authorizationToken;
        return {
          manifestPath: "/tmp/c6-capture/manifest.json",
          manifestSha256: "a".repeat(64),
          requestCount: 7,
        };
      },
      env: { GITHUB_TOKEN: token },
    });

    expect(receivedToken).toBe(token);
    expect(JSON.stringify(result)).not.toContain(token);
    await expect(runC6GitHubRestCaptureCli([
      "--owner=Example",
      "--repo=Project",
      "--pull=7",
      "--resolved-issues=101",
      "--output-dir=/tmp/c6-capture",
    ], {
      capture: async () => {
        throw new Error("must not execute");
      },
      env: {},
    })).rejects.toThrow("GITHUB_TOKEN is required");
  });
});
