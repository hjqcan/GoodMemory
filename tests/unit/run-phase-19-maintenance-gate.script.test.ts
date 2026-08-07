import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  buildPhase19MaintenanceGateCommands,
  resolvePhase19MaintenanceGateOutputDir,
  runPhase19MaintenanceQualityGate,
} from "../../scripts/run-phase-19-maintenance-gate";

describe("run-phase-19-maintenance-gate script", () => {
  it("resolves the dedicated maintenance gate output directory", () => {
    expect(resolvePhase19MaintenanceGateOutputDir("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/quality-gates/phase-19-maintenance",
    );
  });

  it("builds the dedicated maintenance rollout regression command list", () => {
    expect(buildPhase19MaintenanceGateCommands("/tmp/goodmemory")).toEqual([
      {
        label: "typecheck",
        cwd: "/tmp/goodmemory",
        args: ["bun", "run", "typecheck"],
      },
      {
        label: "maintenance-rollout-regressions",
        cwd: "/tmp/goodmemory",
        args: [
          "bun",
          "test",
          "tests/eval/runners.test.ts",
          "tests/eval/suite.test.ts",
          "tests/eval/reporting.test.ts",
          "tests/unit/maintenance.dream.test.ts",
          "tests/integration/maintenance.api.test.ts",
        ],
      },
      {
        label: "retrieval-rollout-regressions",
        cwd: "/tmp/goodmemory",
        args: [
          "bun",
          "test",
          "tests/unit/eval.strategy-rollout.test.ts",
          "tests/unit/eval.strategy-promotion-gate.test.ts",
        ],
      },
      {
        label: "host-adapter-regressions",
        cwd: "/tmp/goodmemory",
        args: [
          "bun",
          "test",
          "tests/unit/markdown-artifacts.test.ts",
          "tests/unit/host.adapter.test.ts",
          "tests/unit/host.writeback.test.ts",
          "tests/examples/examples.test.ts",
          "tests/release/release.test.ts",
        ],
      },
      {
        label: "host-example-claude",
        cwd: "/tmp/goodmemory",
        args: ["bun", "run", "example:host-claude"],
      },
      {
        label: "host-example-codex",
        cwd: "/tmp/goodmemory",
        args: ["bun", "run", "example:host-codex"],
      },
    ]);
  });

  it("writes one accepted maintenance gate report after all commands pass", async () => {
    const calls: string[] = [];
    const written: Array<{ path: string; content: string }> = [];

    const report = await runPhase19MaintenanceQualityGate(
      {
        outputDir: "/tmp/goodmemory/reports/quality-gates/phase-19-maintenance",
        runId: "run-phase19-maintenance",
      },
      {
        now: () => "2026-04-19T12:45:00.000Z",
        ensureDir: async () => {},
        writeTextFile: async (path, content) => {
          written.push({ path, content });
        },
        runCommand: async (command) => {
          calls.push(command.label);

          return {
            exitCode: 0,
            durationMs: 25,
            stdout: `${command.label}: ok\n`,
            stderr: "",
          };
        },
      },
    );

    expect(calls).toEqual([
      "typecheck",
      "maintenance-rollout-regressions",
      "retrieval-rollout-regressions",
      "host-adapter-regressions",
      "host-example-claude",
      "host-example-codex",
    ]);
    expect(report.acceptance).toEqual({
      decision: "accepted",
      reason:
        "Phase 19 maintenance rollout is regression-covered on top of the closed retrieval and host surfaces.",
    });
    expect(report.commands).toHaveLength(6);
    expect(report.runDirectory).toBe(
      "/tmp/goodmemory/reports/quality-gates/phase-19-maintenance/run-phase19-maintenance",
    );
    expect(written[0]?.path).toBe(
      join(
        "/tmp/goodmemory/reports/quality-gates/phase-19-maintenance/run-phase19-maintenance",
        "phase-19-maintenance-quality-gate.json",
      ),
    );
    expect(written[0]?.content).toContain('"phase": "phase-19-maintenance"');
    expect(written[0]?.content).toContain('"decision": "accepted"');
  });

  it("fails fast and records a blocked maintenance report when a required regression command fails", async () => {
    const calls: string[] = [];
    const written: Array<{ path: string; content: string }> = [];

    const report = await runPhase19MaintenanceQualityGate(
      {
        outputDir: "/tmp/goodmemory/reports/quality-gates/phase-19-maintenance",
        runId: "run-phase19-maintenance-fail",
      },
      {
        now: () => "2026-04-19T12:45:00.000Z",
        ensureDir: async () => {},
        writeTextFile: async (path, content) => {
          written.push({ path, content });
        },
        runCommand: async (command) => {
          calls.push(command.label);

          return {
            exitCode: command.label === "maintenance-rollout-regressions" ? 1 : 0,
            durationMs: 10,
            stdout: "",
            stderr:
              command.label === "maintenance-rollout-regressions"
                ? "maintenance regression failed\nstack line\n"
                : "",
          };
        },
      },
    );

    expect(calls).toEqual([
      "typecheck",
      "maintenance-rollout-regressions",
    ]);
    expect(report.acceptance).toEqual({
      decision: "blocked",
      reason: "Required regression command failed: maintenance-rollout-regressions",
    });
    expect(report.commands).toHaveLength(2);
    expect(report.commands[1]?.stderrTail).toEqual([
      "maintenance regression failed",
      "stack line",
    ]);
    expect(written[0]?.content).toContain('"decision": "blocked"');
  });
});
