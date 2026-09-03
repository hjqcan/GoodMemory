import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseC5LivePilotOptions,
  runC5LivePilotCommand,
} from "../../scripts/run-codex-coding-effect-c5-pilot";
import type {
  C5NativeLongitudinalPilotInput,
} from "../../scripts/codex-coding-effect/c5-live-pilot";

describe("Codex coding-effect C5 live CLI", () => {
  it("freezes required analysis inputs and resolves isolated default roots", () => {
    const options = parseC5LivePilotOptions(requiredArgs(), {
      bunExecutable: "/tooling/bun",
      cwd: "/repo/goodmemory",
      homeDir: "/users/eval",
      now: () => "2026-07-16T01:02:03.000Z",
    });

    expect(options).toMatchObject({
      authFile: "/users/eval/.codex/auth.json",
      bunExecutable: "/tooling/bun",
      c4ReadinessCorePath:
        "/repo/goodmemory/reports/quality-gates/phase-73/c4-controlled-pilot-core.json",
      c4ReadinessReportPath:
        "/repo/goodmemory/reports/quality-gates/phase-73/c4-controlled-pilot-readiness.json",
      c4ReadinessWorkspaceRoot:
        "/users/eval/.goodmemory-eval/codex-coding-effect/c5-run-001/c5-pilot/c4-readiness",
      c4ReviewDispatchPath:
        "/repo/goodmemory/fixtures/codex-coding-effect/c4-controlled-pilot/review/dispatch.json",
      c4ReviewInputBundlePath:
        "/repo/goodmemory/fixtures/codex-coding-effect/c4-controlled-pilot/review/input-bundle.json",
      c4ReviewProvenancePath:
        "/repo/goodmemory/fixtures/codex-coding-effect/c4-controlled-pilot/review/provenance.json",
      c4ReviewRequestPath:
        "/repo/goodmemory/fixtures/codex-coding-effect/c4-controlled-pilot/review/request.md",
      c4ReviewResponsePath:
        "/repo/goodmemory/fixtures/codex-coding-effect/c4-controlled-pilot/review/independent-review.json",
      codexExecutable: "codex",
      datasetRoot:
        "/repo/goodmemory/fixtures/codex-coding-effect/c4-controlled-pilot",
      generatedAt: "2026-07-16T01:02:03.000Z",
      materialEffectPercentagePoints: 10,
      model: "gpt-test",
      npmExecutable: "npm",
      orderSeed: 73,
      outputDirectory:
        "/users/eval/.goodmemory-eval/codex-coding-effect/raw/c5-run-001",
      packageTarball: "/repo/goodmemory/dist/goodmemory.tgz",
      reasoningEffort: "xhigh",
      resume: false,
      runId: "c5-run-001",
      runtimeRoot:
        "/users/eval/.goodmemory-eval/codex-coding-effect/c5-run-001/c5-pilot/runtime",
      sourceRoot:
        "/users/eval/.goodmemory-eval/codex-coding-effect/c5-run-001/c5-pilot/source",
      stageTimeoutMs: 900_000,
      testTimeoutMs: 300_000,
      workspaceRoot:
        "/users/eval/.goodmemory-eval/codex-coding-effect/c5-run-001/c5-pilot/workspaces",
    });
    expect(options.baselineRawStageEvidenceRoot).toBe(
      "/repo/goodmemory/reports/quality-gates/phase-73/c4-baseline-ceiling-pilot/raw-stages",
    );
    expect("npmCacheSeed" in options).toBe(false);
  });

  it("resolves an optional npm cache seed as a protected read-only input", () => {
    const options = parseC5LivePilotOptions(
      [...requiredArgs(), "--npm-cache-seed", "artifacts/npm-cache-seed"],
      defaults(),
    );
    expect(options.npmCacheSeed).toBe("/repo/goodmemory/artifacts/npm-cache-seed");
    expect("npmRegistry" in options).toBe(false);
    expect(parseC5LivePilotOptions(
      [...requiredArgs(), "--npm-registry", "https://registry.npmmirror.com"],
      defaults(),
    ).npmRegistry).toBe("https://registry.npmmirror.com");
    expect(() => parseC5LivePilotOptions(
      [...requiredArgs(), "--npm-registry", "http://registry.npmmirror.com"],
      defaults(),
    )).toThrow(/--npm-registry/u);
    expect(() => parseC5LivePilotOptions(
      [...requiredArgs(), "--npm-cache-seed", "/tmp/npm-cache-seed"],
      defaults(),
    )).toThrow(/--npm-cache-seed/u);
    expect(() => parseC5LivePilotOptions(
      [
        ...requiredArgs(),
        "--npm-cache-seed",
        "/users/eval/.goodmemory-eval/codex-coding-effect/c5-run-001/c5-pilot/runtime/seed",
      ],
      defaults(),
    )).toThrow(/--npm-cache-seed|--runtime-root/u);
  });

  it("rejects post-hoc, duplicate, unknown, and overlapping run inputs", () => {
    expect(() => parseC5LivePilotOptions([
      ...requiredArgs().filter((value) => value !== "10"),
    ], defaults())).toThrow();
    expect(() => parseC5LivePilotOptions([
      ...requiredArgs(),
      "--order-seed",
      "74",
    ], defaults())).toThrow("cannot be specified more than once");
    expect(() => parseC5LivePilotOptions([
      ...requiredArgs(),
      "--material-effect-pp",
      "51",
    ], defaults())).toThrow();
    expect(() => parseC5LivePilotOptions([
      ...requiredArgs(),
      "--unknown",
      "value",
    ], defaults())).toThrow("unknown option");
    expect(() => parseC5LivePilotOptions([
      ...requiredArgs(),
      "--runtime-root",
      "/safe/shared",
      "--workspace-root",
      "/safe/shared/workspaces",
    ], defaults())).toThrow("must not overlap");
    expect(() => parseC5LivePilotOptions([
      ...requiredArgs(),
      "--runtime-root",
      "/repo/goodmemory/fixtures/codex-coding-effect/c4-controlled-pilot/runtime",
    ], defaults())).toThrow("--runtime-root must not overlap --dataset-root");
  });

  it("dispatches the parsed live input exactly once", async () => {
    const calls: unknown[] = [];
    const result = await runC5LivePilotCommand(requiredArgs(), {
      defaults: {
        ...defaults(),
        now: () => "2026-07-16T01:02:03.000Z",
      },
      run: async (
        input: Omit<C5NativeLongitudinalPilotInput, "dependencies">,
      ) => {
        calls.push(input);
        return { marker: "complete" };
      },
    });

    expect(result).toEqual({ marker: "complete" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      materialEffectPercentagePoints: 10,
      orderSeed: 73,
      runId: "c5-run-001",
    });
  });

  it("parses one strict resume flag and rejects duplicates", () => {
    expect(parseC5LivePilotOptions([
      ...requiredArgs(),
      "--resume",
    ], defaults()).resume).toBe(true);
    expect(() => parseC5LivePilotOptions([
      ...requiredArgs(),
      "--resume",
      "--resume",
    ], defaults())).toThrow("--resume cannot be specified more than once");
  });

  it("rejects a missing mutable root whose existing symlink ancestor enters fixed temp", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-cli-symlink-"));
    try {
      const bridge = join(root, "bridge");
      await symlink("/tmp", bridge);
      expect(() => parseC5LivePilotOptions([
        ...requiredArgs(),
        "--runtime-root",
        join(bridge, "not-created-yet"),
      ], defaults())).toThrow(
        "--runtime-root must not resolve under a fixed temporary root",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function requiredArgs(): string[] {
  return [
    "--package-tarball",
    "dist/goodmemory.tgz",
    "--run-id",
    "c5-run-001",
    "--codex-model",
    "gpt-test",
    "--reasoning-effort",
    "xhigh",
    "--material-effect-pp",
    "10",
    "--order-seed",
    "73",
  ];
}

function defaults() {
  return {
    bunExecutable: "/tooling/bun",
    cwd: "/repo/goodmemory",
    homeDir: "/users/eval",
    now: () => "2026-07-16T01:02:03.000Z",
  };
}
