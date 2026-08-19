import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  parseCodexC3PilotOptions,
} from "../../scripts/codex-coding-effect/c3-pilot-options";

const defaults = {
  bunBinary: "/opt/bun/bin/bun",
  cwd: "/repo",
  homeDir: "/home/tester",
};

describe("Codex coding-effect C3 pilot CLI", () => {
  it("freezes the real paired pilot identity and isolated roots", () => {
    expect(parseCodexC3PilotOptions([
      "--package-tarball",
      "artifacts/goodmemory.tgz",
      "--run-id",
      "c3-pilot-001",
      "--codex-model",
      "gpt-5.6-sol",
      "--reasoning-effort",
      "xhigh",
    ], defaults)).toEqual({
      authFile: "/home/tester/.codex/auth.json",
      bunBinary: "/opt/bun/bin/bun",
      codexBinary: "codex",
      codexModel: "gpt-5.6-sol",
      fixtureRoot:
        "/home/tester/.goodmemory-eval/codex-coding-effect/c3-pilot-001/c3-pilot/fixture",
      goodMemorySourceRoot: "/repo",
      npmBinary: "npm",
      outputDir: "/home/tester/.goodmemory-eval/codex-coding-effect/raw",
      packageTarball: "/repo/artifacts/goodmemory.tgz",
      reasoningEffort: "xhigh",
      runId: "c3-pilot-001",
      runOutputDir:
        "/home/tester/.goodmemory-eval/codex-coding-effect/raw/c3-pilot-001",
      runtimeRoot:
        "/home/tester/.goodmemory-eval/codex-coding-effect/c3-pilot-001/c3-pilot/runtime",
      stageTimeoutMs: 900_000,
      testTimeoutMs: 300_000,
      workspaceRoot:
        "/home/tester/.goodmemory-eval/codex-coding-effect/c3-pilot-001/c3-pilot/workspaces",
    });
  });

  it("requires a tarball, run id, model, and reasoning effort", () => {
    expect(() => parseCodexC3PilotOptions([], defaults))
      .toThrow("--package-tarball is required");
    expect(() => parseCodexC3PilotOptions([
      "--package-tarball",
      "goodmemory.tgz",
      "--run-id",
      "c3",
      "--codex-model",
      "gpt-5.6-sol",
    ], defaults)).toThrow("--reasoning-effort is required");
  });

  it("rejects duplicate, unknown, traversing, and overlapping values", () => {
    const required = requiredArgs();
    expect(() => parseCodexC3PilotOptions([
      ...required,
      "--reasoning-effort",
      "high",
    ], defaults)).toThrow(
      "--reasoning-effort cannot be specified more than once",
    );
    expect(() => parseCodexC3PilotOptions([
      ...required.slice(0, 2),
      "--run-id",
      "../c3",
      ...required.slice(4),
    ], defaults)).toThrow("--run-id must be a single path segment");
    expect(() => parseCodexC3PilotOptions([
      ...required,
      "--surprise",
    ], defaults)).toThrow("unknown option --surprise");
    expect(() => parseCodexC3PilotOptions([
      ...required,
      "--runtime-root",
      "/repo",
    ], defaults)).toThrow(
      "--runtime-root must not overlap --package-tarball",
    );
    expect(() => parseCodexC3PilotOptions([
      ...required,
      "--output-dir",
      "/repo/reports/c3",
    ], defaults)).toThrow(
      "--output-dir must not overlap --runner-checkout",
    );
  });

  it("rejects every fixed platform temporary root for sensitive paths", () => {
    for (const root of [
      "/tmp",
      "/private/tmp",
      "/var/tmp",
      "/private/var/tmp",
    ]) {
      expect(() => parseCodexC3PilotOptions([
        ...requiredArgs(),
        "--runtime-root",
        `${root}/c3-runtime`,
      ], defaults)).toThrow(
        "--runtime-root must not resolve under a fixed temporary root",
      );
    }
  });

  it("fails closed when any sensitive C3 input or output uses temporary storage", () => {
    for (const [flag, path] of [
      ["--workspace-root", "/tmp/c3-workspaces"],
      ["--fixture-root", "/tmp/c3-fixture"],
      ["--output-dir", "/tmp/c3-output"],
      ["--auth-file", "/tmp/codex-auth.json"],
      ["--goodmemory-source-root", "/tmp/goodmemory-source"],
    ] as const) {
      expect(() => parseCodexC3PilotOptions([
        ...requiredArgs(),
        flag,
        path,
      ], defaults)).toThrow(
        `${flag} must not resolve under a fixed temporary root`,
      );
    }
    expect(() => parseCodexC3PilotOptions(
      requiredArgs("/tmp/goodmemory.tgz"),
      defaults,
    )).toThrow(
      "--package-tarball must not resolve under a fixed temporary root",
    );

    expect(() => parseCodexC3PilotOptions([
      "--package-tarball",
      "/repo/goodmemory.tgz",
      "--run-id",
      "c3",
      "--codex-model",
      "gpt-5.6-sol",
      "--reasoning-effort",
      "xhigh",
      "--goodmemory-source-root",
      "/repo",
    ], {
      ...defaults,
      cwd: "/tmp/c3-runner",
    })).toThrow(
      "--runner-checkout must not resolve under a fixed temporary root",
    );
  });

  it("resolves the nearest existing ancestor before accepting a missing path", async () => {
    const root = await mkdtemp(join(process.cwd(), ".c3-path-test-"));
    const alias = join(root, "temp-alias");
    try {
      await symlink("/tmp", alias);
      expect(() => parseCodexC3PilotOptions([
        ...requiredArgs(),
        "--runtime-root",
        join(alias, "nonexistent-runtime"),
      ], {
        ...defaults,
        cwd: process.cwd(),
      })).toThrow(
        "--runtime-root must not resolve under a fixed temporary root",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("uses physical paths when checking overlap below symlink ancestors", async () => {
    const root = await mkdtemp(join(homedir(), ".c3-overlap-test-"));
    const physical = join(root, "physical");
    const alias = join(root, "alias");
    try {
      await mkdir(physical);
      await symlink(physical, alias);
      expect(() => parseCodexC3PilotOptions([
        ...requiredArgs(),
        "--runtime-root",
        join(alias, "runtime"),
        "--workspace-root",
        join(physical, "runtime/workspaces"),
      ], {
        ...defaults,
        cwd: root,
      })).toThrow("--runtime-root must not overlap --workspace-root");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function requiredArgs(packageTarball = "goodmemory.tgz"): string[] {
  return [
    "--package-tarball",
    packageTarball,
    "--run-id",
    "c3",
    "--codex-model",
    "gpt-5.6-sol",
    "--reasoning-effort",
    "xhigh",
  ];
}
