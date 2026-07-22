import { describe, expect, it } from "bun:test";
import {
  buildPhase41FallbackRunId,
  parsePhase41EvalCliOptions,
  resolvePhase41FallbackOutputDir,
  runPhase41FallbackEval,
} from "../../scripts/run-phase-41-eval";

describe("run-phase-41 eval script", () => {
  it("resolves the phase-41 deterministic output directory", () => {
    expect(resolvePhase41FallbackOutputDir("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/eval/fallback/phase-41",
    );
  });

  it("builds a deterministic phase-41 run id", () => {
    expect(buildPhase41FallbackRunId("2026-04-25T19:30:45.000Z")).toBe(
      "run-20260425193045",
    );
  });

  it("parses phase-41 eval cli flags", () => {
    expect(
      parsePhase41EvalCliOptions([
        "bun",
        "run",
        "scripts/run-phase-41-eval.ts",
        "--output-dir",
        "/tmp/phase41",
        "--run-id",
        "run-phase41",
      ]),
    ).toEqual({
      outputDir: "/tmp/phase41",
      runId: "run-phase41",
    });
  });

  it("writes an accepted deterministic installed pre-action report with dual baselines", async () => {
    const writes: Array<{ content: string; path: string }> = [];
    const directories: string[] = [];

    const report = await runPhase41FallbackEval(
      {
        outputDir: "/tmp/goodmemory/reports/eval/fallback/phase-41",
        runId: "run-phase41",
      },
      {
        ensureDir: async (path) => {
          directories.push(path);
        },
        now: () => "2026-04-25T19:30:45.000Z",
        writeTextFile: async (path, content) => {
          writes.push({ path, content });
        },
      },
    );

    expect(report.phase).toBe("phase-41");
    expect(report.mode).toBe("fallback");
    expect(report.runId).toBe("run-phase41");
    expect(report.acceptance.decision).toBe("accepted");
    expect(report.summary).toEqual({
      installedNonRegressionPassCount: 3,
      installedWinOverNoMemoryCount: 3,
      storageParityPassCount: 1,
      totalCases: 4,
    });
    expect(report.comparison.baselines.installedPolicyBacked).toBe(
      "installed-policy-backed",
    );
    expect(
      report.cases.find((caseResult) => caseResult.caseId === "command-rewrite")
        ?.installedPolicyBacked.executedStep,
    ).toBe("./tools/QuickCheck");
    expect(
      report.cases.find((caseResult) => caseResult.caseId === "command-blocked-veto")
        ?.installedPolicyBacked.blocked,
    ).toBe(true);
    expect(
      report.cases.find((caseResult) => caseResult.caseId === "command-blocked-veto")
        ?.installedPolicyBacked.originalAction,
    ).toBe("rm -rf AGENTS.md");
    expect(
      report.cases.find((caseResult) => caseResult.caseId === "low-risk-guidance")
        ?.installedPolicyBacked.decision,
    ).toBe("allow_with_guidance");
    expect(
      report.cases.find((caseResult) => caseResult.caseId === "low-risk-guidance")
        ?.installedPolicyBacked.guidance.length,
    ).toBeGreaterThan(0);
    expect(
      report.cases.find((caseResult) => caseResult.caseId === "low-risk-guidance")
        ?.installedPolicyBacked.reason,
    ).toBe("Guidance: Use the current runbook before deploy.");
    expect(report.evidence.installedStorageParity.sharedInstalledStorage).toBe(true);
    expect(report.evidence.installedStorageParity.actionTraceRecorded).toBe(true);
    expect(report.evidence.installedStorageParity.followupTraceRecorded).toBe(true);
    expect(directories).toEqual([
      "/tmp/goodmemory/reports/eval/fallback/phase-41/run-phase41",
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe(
      "/tmp/goodmemory/reports/eval/fallback/phase-41/run-phase41/report.json",
    );
    expect(JSON.parse(writes[0]!.content)).toEqual(report);
  });
});
