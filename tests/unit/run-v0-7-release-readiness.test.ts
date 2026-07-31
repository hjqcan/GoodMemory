import { readFileSync } from "node:fs";

import { describe, expect, it } from "bun:test";

import type { V07ReleaseReadinessReport } from "../../scripts/run-v0-7-release-readiness";
import {
  evaluateV07RuntimeVersions,
  evaluateV07SourceIdentity,
  evaluateV07SourceStability,
  evaluateVersionConsistency,
  evaluateV07RequiredEnvironment,
  evaluateV07PackManifest,
  evaluateV07RequiredChecks,
  parseV07ReleaseReadinessCliOptions,
  renderV07ReleaseSummary,
  V07_RELEASE_REQUIRED_COMMANDS,
} from "../../scripts/run-v0-7-release-readiness";

function report(
  overrides: Partial<V07ReleaseReadinessReport> = {},
): V07ReleaseReadinessReport {
  return {
    allRequiredPassed: false,
    checks: [
      {
        detail: "package is 0.7.0",
        durationMs: 1,
        id: "version",
        required: true,
        status: "pass",
        title: "Version consistency",
      },
      {
        detail: "tarball is too large | 4194305 bytes",
        durationMs: 1,
        id: "pack",
        required: true,
        status: "fail",
        title: "Package manifest and size",
      },
    ],
    generatedAt: "2026-07-21T00:00:00.000Z",
    generatedBy: "scripts/run-v0-7-release-readiness.ts",
    packageVersion: "0.7.0",
    runtime: {
      bunVersion: "1.3.14",
      nodeVersion: "v20.19.0",
    },
    sourceIdentity: {
      commitSha: "a".repeat(40),
      treeSha: "b".repeat(40),
    },
    summary: { failed: 1, passed: 1, skipped: 0, total: 2 },
    ...overrides,
  };
}

describe("v0.7 release readiness", () => {
  it("allows current claims to stay empty until 0.7 benchmarks are rerun", async () => {
    await expect(
      evaluateVersionConsistency(
        new URL("../..", import.meta.url).pathname,
      ),
    ).resolves.toEqual(expect.objectContaining({ status: "pass" }));
  });

  it("pins package, lockfile, capability, and MCP descriptors to 0.7.0", () => {
    const readJson = (path: string) =>
      JSON.parse(
        readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"),
      ) as {
        packages?: Record<string, { version?: string }> | Array<{ version?: string }>;
        releaseStatus?: { npmDistTag?: string; status?: string };
        version?: string;
      };
    const packageJson = readJson("package.json");
    const packageLock = readJson("package-lock.json");
    const capability = readJson(".well-known/goodmemory.json");
    const server = readJson("server.json");

    expect(packageJson.version).toBe("0.7.0");
    expect(packageLock.version).toBe("0.7.0");
    expect((packageLock.packages as Record<string, { version?: string }>)[""]?.version).toBe(
      "0.7.0",
    );
    expect(capability.version).toBe("0.7.0");
    expect(capability.releaseStatus).toEqual(expect.objectContaining({
      npmDistTag: "latest",
      status: "stable",
    }));
    expect(server.version).toBe("0.7.0");
    expect((server.packages as Array<{ version?: string }>)[0]?.version).toBe("0.7.0");
  });

  it("requires the 0.7 migration guide and a compressed tarball below 4 MiB", () => {
    expect(
      evaluateV07PackManifest(
        [
          "dist/index.js",
          "dist/index.d.ts",
          "dist/ai-sdk/index.js",
          "dist/ai-sdk/index.d.ts",
          "dist/host/index.js",
          "dist/host/index.d.ts",
          "dist/http/index.js",
          "dist/http/index.d.ts",
          "dist/runtime-kit/index.js",
          "dist/runtime-kit/index.d.ts",
          "docs/GoodMemory-0.6-to-0.7-Migration-Guide.md",
          "package.json",
        ],
        4 * 1024 * 1024 - 1,
      ),
    ).toEqual([]);
    expect(
      evaluateV07PackManifest(["dist/index.js", "package.json"], 4 * 1024 * 1024),
    ).toEqual([
      "tarball missing: dist/index.d.ts, dist/ai-sdk/index.js, dist/ai-sdk/index.d.ts, dist/host/index.js, dist/host/index.d.ts, dist/http/index.js, dist/http/index.d.ts, dist/runtime-kit/index.js, dist/runtime-kit/index.d.ts, docs/GoodMemory-0.6-to-0.7-Migration-Guide.md",
      "compressed tarball 4194304 bytes must be below 4194304 bytes",
    ]);
  });

  it("binds readiness to one clean commit and tree", () => {
    expect(evaluateV07SourceIdentity({
      commitSha: "a".repeat(40),
      status: "",
      treeSha: "b".repeat(40),
    })).toEqual({
      check: expect.objectContaining({ status: "pass" }),
      sourceIdentity: {
        commitSha: "a".repeat(40),
        treeSha: "b".repeat(40),
      },
    });
    expect(evaluateV07SourceIdentity({
      commitSha: "a".repeat(40),
      status: " M src/index.ts",
      treeSha: "b".repeat(40),
    }).check).toEqual(expect.objectContaining({
      detail: expect.stringContaining("src/index.ts"),
      status: "fail",
    }));
  });

  it("rejects source drift while release checks are running", () => {
    const initial = {
      commitSha: "a".repeat(40),
      treeSha: "b".repeat(40),
    };
    expect(evaluateV07SourceStability({
      final: {
        check: {
          detail: "clean source",
          durationMs: 0,
          id: "source-identity",
          required: true,
          status: "pass",
          title: "Exact source identity",
        },
        sourceIdentity: initial,
      },
      initial,
    })).toEqual(expect.objectContaining({ status: "pass" }));
    expect(evaluateV07SourceStability({
      final: {
        check: {
          detail: "clean source",
          durationMs: 0,
          id: "source-identity",
          required: true,
          status: "pass",
          title: "Exact source identity",
        },
        sourceIdentity: {
          commitSha: "c".repeat(40),
          treeSha: "d".repeat(40),
        },
      },
      initial,
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("changed while release checks ran"),
      status: "fail",
    }));
  });

  it("requires the release consumer to execute with Node 20", () => {
    expect(evaluateV07RuntimeVersions({
      bunVersion: "1.3.14",
      nodeVersion: "v20.19.4",
    })).toEqual(expect.objectContaining({ status: "pass" }));
    expect(evaluateV07RuntimeVersions({
      bunVersion: "1.3.11",
      nodeVersion: "v22.14.0",
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("Node 20"),
      status: "fail",
    }));
    expect(evaluateV07RuntimeVersions({
      bunVersion: "1.3.11",
      nodeVersion: "v20.19.4",
    })).toEqual(expect.objectContaining({
      detail: expect.stringContaining("Bun 1.3.14"),
      status: "fail",
    }));
  });

  it("rejects duplicate CLI flags", () => {
    expect(() =>
      parseV07ReleaseReadinessCliOptions(["--strict", "--strict"]),
    ).toThrow("--strict cannot be specified more than once.");
    expect(() =>
      parseV07ReleaseReadinessCliOptions([
        "--output-dir",
        "/tmp/a",
        "--output-dir",
        "/tmp/b",
      ]),
    ).toThrow("--output-dir cannot be specified more than once.");
  });

  it("runs every mandatory release command instead of a focused substitute", () => {
    expect(V07_RELEASE_REQUIRED_COMMANDS).toEqual([
      {
        args: ["run", "typecheck"],
        command: "bun",
        id: "typecheck",
      },
      {
        args: ["test"],
        command: "bun",
        id: "tests",
      },
      {
        args: ["run", "test:coverage"],
        command: "bun",
        id: "coverage",
      },
      {
        args: ["run", "build"],
        command: "bun",
        id: "build",
      },
      {
        args: ["run", "gate:public-benchmark-claim", "--strict"],
        command: "bun",
        id: "public-claims",
      },
      {
        args: [
          "run",
          "gate:phase-74-storage-scale",
          "--output",
          "reports/release/v0.7/phase-74-storage-scale-gate.json",
        ],
        command: "bun",
        id: "scale",
      },
      {
        args: [
          "test",
          "tests/integration/storage.postgres.test.ts",
          "tests/integration/api.postgres.test.ts",
        ],
        command: "bun",
        id: "postgres",
        requiredEnvironment: "GOODMEMORY_TEST_POSTGRES_URL",
      },
    ]);
  });

  it("fails readiness when a required check is skipped", () => {
    expect(
      evaluateV07RequiredChecks([
        {
          detail: "skipped via --skip-tests",
          durationMs: 0,
          id: "tests",
          required: true,
          status: "skip",
          title: "Full canonical Bun test suite",
        },
      ]),
    ).toBe(false);
  });

  it("fails the real Postgres check when its required URL is unavailable", () => {
    expect(
      evaluateV07RequiredEnvironment({
        environment: {},
        environmentName: "GOODMEMORY_TEST_POSTGRES_URL",
        id: "postgres",
        title: "Real Postgres gate",
      }),
    ).toEqual({
      detail: "GOODMEMORY_TEST_POSTGRES_URL is required for the release gate",
      durationMs: 0,
      id: "postgres",
      required: true,
      status: "fail",
      title: "Real Postgres gate",
    });
    expect(
      evaluateV07RequiredEnvironment({
        environment: {
          GOODMEMORY_TEST_POSTGRES_URL: "postgres://localhost/goodmemory",
        },
        environmentName: "GOODMEMORY_TEST_POSTGRES_URL",
        id: "postgres",
        title: "Real Postgres gate",
      }),
    ).toBeUndefined();
  });

  it("prohibits skip flags in strict mode", () => {
    expect(() =>
      parseV07ReleaseReadinessCliOptions(["--strict", "--skip-tests"]),
    ).toThrow("--strict cannot be combined with release-check skip flags.");
  });

  it("passes the configured Postgres URL into the strict release workflow", () => {
    const workflow = readFileSync(
      new URL("../../.github/workflows/release.yml", import.meta.url),
      "utf8",
    );

    expect(workflow).toContain("secrets.GOODMEMORY_TEST_POSTGRES_URL");
    expect(workflow).toContain("bun run gate:v0.7 --strict");
  });

  it("renders the v0.7 verdict and escapes markdown table pipes", () => {
    const markdown = renderV07ReleaseSummary(report());
    expect(markdown).toContain("# v0.7 Release Readiness");
    expect(markdown).toContain("REQUIRED CHECK(S) FAILED");
    expect(markdown).toContain("too large \\| 4194305 bytes");
    expect(markdown).toContain(`source commit: ${"a".repeat(40)}`);
    expect(markdown).toContain("runtime: Node v20.19.0 / Bun 1.3.14");
  });
});
