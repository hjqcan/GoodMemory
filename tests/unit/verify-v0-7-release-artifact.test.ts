import { describe, expect, it } from "bun:test";

import { buildV07PrepublishEvidence } from "../../scripts/verify-v0-7-release-artifact";

describe("v0.7 prepublish artifact evidence", () => {
  it("binds exact artifact bytes, source identity, and release runtimes", () => {
    const evidence = buildV07PrepublishEvidence({
      artifactBytes: Buffer.from("stable artifact"),
      artifactPath: "/tmp/goodmemory-0.7.2.tgz",
      runtime: {
        bunVersion: "1.3.14",
        nodeVersion: "v20.20.2",
      },
      sourceCommit: "a".repeat(40),
      sourceTree: "b".repeat(40),
    });

    expect(evidence).toEqual({
      artifactName: "goodmemory-0.7.2.tgz",
      artifactPath: "/tmp/goodmemory-0.7.2.tgz",
      generatedBy: "scripts/verify-v0-7-release-artifact.ts",
      integrity: expect.stringMatching(/^sha512-/u),
      runtime: {
        bunVersion: "1.3.14",
        nodeVersion: "v20.20.2",
      },
      sourceCommit: "a".repeat(40),
      sourceTree: "b".repeat(40),
      version: "0.7.2",
    });
  });

  it("rejects an unbound source or wrong release runtime", () => {
    const base = {
      artifactBytes: Buffer.from("stable artifact"),
      artifactPath: "/tmp/goodmemory-0.7.2.tgz",
      runtime: {
        bunVersion: "1.3.14",
        nodeVersion: "v20.20.2",
      },
      sourceCommit: "a".repeat(40),
      sourceTree: "b".repeat(40),
    };
    expect(() => buildV07PrepublishEvidence({
      ...base,
      sourceCommit: "",
    })).toThrow("source commit");
    expect(() => buildV07PrepublishEvidence({
      ...base,
      sourceTree: "not-a-tree",
    })).toThrow("source tree");
    expect(() => buildV07PrepublishEvidence({
      ...base,
      runtime: { ...base.runtime, bunVersion: "1.3.11" },
    })).toThrow("Bun 1.3.14");
  });

  it("requires the packed artifact integrity at the CLI boundary", async () => {
    const child = Bun.spawn({
      cmd: [
        "bun",
        new URL(
          "../../scripts/verify-v0-7-release-artifact.ts",
          import.meta.url,
        ).pathname,
        "--artifact",
        "/tmp/goodmemory-0.7.2.tgz",
        "--source-commit",
        "a".repeat(40),
        "--source-tree",
        "b".repeat(40),
      ],
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--expected-integrity is required");
  });
});
