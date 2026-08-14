import { describe, expect, it } from "bun:test";
import {
  parsePhase50GateCliOptions,
  PHASE50_CANONICAL_GATE_RUN_ID,
  resolvePhase50CanonicalEvalReportPath,
  resolvePhase50GateOutputDir,
  runPhase50Gate,
} from "../../scripts/run-phase-50-gate";
import { PHASE50_CANONICAL_RUN_ID } from "../../scripts/run-phase-50-installer-eval";

function buildAcceptedEvalReport() {
  return {
    acceptance: {
      decision: "accepted",
      reason: "ok",
    },
    generatedAt: "2026-04-28T22:30:00.000Z",
    generatedBy: "scripts/run-phase-50-installer-eval.ts",
    mode: "installer-cli-runtime-shell-hardening",
    outputDir: "/tmp/goodmemory/reports/eval/fallback/phase-50",
    phase: "phase-50",
    runDirectory:
      "/tmp/goodmemory/reports/eval/fallback/phase-50/run-20260428223000-installer-eval",
    runId: PHASE50_CANONICAL_RUN_ID,
    scenarios: [
      {
        checks: {
          installDefaultWritebackOff: true,
          setupClaudeDefaultWritebackOff: true,
          setupCodexDefaultWritebackOff: true,
        },
        name: "default-writeback-off",
        status: "passed",
      },
      { checks: { ok: true }, name: "dry-run-no-mutation", status: "passed" },
      { checks: { ok: true }, name: "doctor-missing", status: "passed" },
      { checks: { ok: true }, name: "repair-managed-wiring", status: "passed" },
    ],
    summary: {
      dryRunDoesNotWrite: true,
      repairPreservesWriteback: true,
      repairRestoresManagedWiring: true,
      scenarioCount: 4,
      writebackDefaultEscalated: false,
    },
  };
}

describe("run-phase-50 gate", () => {
  it("resolves output paths and parses cli flags", () => {
    expect(resolvePhase50GateOutputDir("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/quality-gates/phase-50",
    );
    expect(resolvePhase50CanonicalEvalReportPath("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/eval/fallback/phase-50/run-20260428223000-installer-eval/report.json",
    );
    expect(
      parsePhase50GateCliOptions([
        "bun",
        "run",
        "scripts/run-phase-50-gate.ts",
        "--eval-report",
        "/tmp/report.json",
        "--output-dir",
        "/tmp/out",
        "--run-id",
        "run-phase50-gate",
      ]),
    ).toEqual({
      evalReportPath: "/tmp/report.json",
      outputDir: "/tmp/out",
      runId: "run-phase50-gate",
    });
  });

  it("blocks current-tree acceptance after historical package aliases leave the command surface", async () => {
    const writes = new Map<string, string>();
    const report = await runPhase50Gate(
      {
        evalReportPath: "/tmp/report.json",
        outputDir: "/tmp/goodmemory-phase50-gate",
        runId: PHASE50_CANONICAL_GATE_RUN_ID,
      },
      {
        ensureDir: async () => {},
        now: () => "2026-04-28T22:45:00.000Z",
        readTextFile: async (path) => {
          if (path === "/tmp/report.json") {
            return `${JSON.stringify(buildAcceptedEvalReport())}\n`;
          }
          throw new Error(`unexpected read: ${path}`);
        },
        runCommand: async () => ({
          durationMs: 1,
          exitCode: 0,
          stderr: "",
          stdout: "ok",
        }),
        writeTextFile: async (path, content) => {
          writes.set(path, content);
        },
      },
    );

    expect(report.acceptance).toEqual({
      decision: "blocked",
      reason: "Phase 50 package scripts are not registered.",
    });
    expect(report.evidence.cliContractsCovered).toBe(true);
    expect(report.evidence.dryRunDoesNotWrite).toBe(true);
    expect(report.evidence.noDefaultWritebackEscalation).toBe(true);
    expect(report.evidence.packageScriptsRegistered).toBe(false);
    expect(report.commands).toHaveLength(3);
    expect([...writes.keys()][0]).toContain("phase-50-quality-gate.json");
  });

  it("blocks when a required command fails", async () => {
    const report = await runPhase50Gate(
      {
        outputDir: "/tmp/goodmemory-phase50-gate",
        runId: "run-blocked",
      },
      {
        ensureDir: async () => {},
        now: () => "2026-04-28T22:45:00.000Z",
        runCommand: async () => ({
          durationMs: 1,
          exitCode: 1,
          stderr: "failed",
          stdout: "",
        }),
        writeTextFile: async () => {},
      },
    );

    expect(report.acceptance.decision).toBe("blocked");
    expect(report.commands).toHaveLength(1);
    expect(report.commands[0]?.stderrTail).toEqual(["failed"]);
  });
});
