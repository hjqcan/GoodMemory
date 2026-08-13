import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImplicitMemBenchResearchDependencies } from "../../src/eval/implicitmembench-research";
import { runPhase59Eval } from "../../scripts/run-phase-59-eval";
import {
  PHASE59_CANONICAL_GATE_RUN_ID,
  runPhase59Gate,
} from "../../scripts/run-phase-59-gate";
import {
  PHASE59_CANONICAL_LIVE_RUN_ID,
  runPhase59LiveMemoryEval,
} from "../../scripts/run-phase-59-live-memory";
import {
  parsePhase59CliOptions,
  resolvePhase59AdapterManifestPath,
  resolvePhase59BenchmarkRoot,
  resolvePhase59FallbackOutputDir,
  resolvePhase59FixtureRoot,
  resolvePhase59LiveMemoryOutputDir,
} from "../../scripts/run-phase-59-shared";

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

describe("run-phase-59 scripts", () => {
  it("resolves phase-59 fixture and output directories", () => {
    expect(resolvePhase59FixtureRoot("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/fixtures/implicitmembench-phase-59",
    );
    expect(resolvePhase59BenchmarkRoot("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/fixtures/implicitmembench-phase-59",
    );
    expect(resolvePhase59AdapterManifestPath("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/fixtures/implicitmembench-phase-59/adapter-manifest.json",
    );
    expect(resolvePhase59FallbackOutputDir("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/eval/fallback/phase-59",
    );
    expect(resolvePhase59LiveMemoryOutputDir("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/eval/live-memory/phase-59",
    );
  });

  it("parses phase-59 cli flags", () => {
    expect(
      parsePhase59CliOptions([
        "bun",
        "run",
        "scripts/run-phase-59-eval.ts",
        "--benchmark-root",
        "/tmp/bench",
        "--output-dir",
        "/tmp/out",
        "--run-id",
        "run-phase59",
        "--limit",
        "60",
      ]),
    ).toEqual({
      benchmarkRoot: "/tmp/bench",
      limit: 60,
      outputDir: "/tmp/out",
      runId: "run-phase59",
      smoke: false,
    });
  });

  it("runs phase-59 fallback eval through the targeted fixture root", async () => {
    let receivedInput:
      | {
          benchmarkRoot: string;
          generatedBy: string;
          manifestPath: string;
          mode: string;
          outputDir: string;
        }
      | undefined;

    const report = await runPhase59Eval(
      {
        limit: 60,
      },
      {
        runEvaluation: async (input) => {
          receivedInput = {
            benchmarkRoot: input.benchmarkRoot,
            generatedBy: input.generatedBy,
            manifestPath: input.manifestPath,
            mode: input.mode,
            outputDir: input.outputDir,
          };
          return {
            benchmarkRoot: input.benchmarkRoot,
            generatedAt: "2026-05-04T00:00:00.000Z",
            generatedBy: input.generatedBy,
            kind: "goodmemory",
            manifestPath: input.manifestPath,
            mode: input.mode,
            outputDir: input.outputDir,
            profiles: {},
            runDirectory: `${input.outputDir}/run-phase59`,
            runId: input.runId ?? "run-phase59",
            source: {
              benchmark: "ImplicitMemBench",
              license: "CC BY 4.0",
              url: "https://github.com/qinchonghanzuibang/ImplicitMemBench",
            },
            summary: {
              caseCountsByDataset: {
                classical_conditioning: 32,
                priming: 0,
                procedural_memory: 28,
              },
              caseCountsByScorer: {
                priming_pair_judge: 0,
                structured_first_action: 28,
                text_behavior_judge: 32,
              },
              executionFailures: 0,
              explicitRecallLeakCount: 0,
              passedBlockingCases: 44,
              primingAverageScore: 0,
              totalBlockingCases: 60,
              totalCases: 60,
            },
          };
        },
      },
    );

    expect(report.kind).toBe("goodmemory");
    expect(receivedInput?.mode).toBe("smoke");
    expect(receivedInput?.benchmarkRoot).toContain(
      "/fixtures/implicitmembench-phase-59",
    );
    expect(receivedInput?.manifestPath).toContain(
      "/fixtures/implicitmembench-phase-59/adapter-manifest.json",
    );
    expect(receivedInput?.generatedBy).toBe("scripts/run-phase-59-eval.ts");
  });

  it("runs phase-59 live-memory eval with canonical live run id by default", async () => {
    let receivedInput:
      | {
          mode: string;
          outputDir: string;
          runId: string | undefined;
        }
      | undefined;

    const report = await runPhase59LiveMemoryEval(undefined, {
      researchDependencies: {} as ImplicitMemBenchResearchDependencies,
      runEvaluation: async (input) => {
        receivedInput = {
          mode: input.mode,
          outputDir: input.outputDir,
          runId: input.runId,
        };
        return {
          benchmarkRoot: input.benchmarkRoot,
          generatedAt: "2026-05-04T00:00:00.000Z",
          generatedBy: input.generatedBy,
          kind: "goodmemory",
          manifestPath: input.manifestPath,
          mode: input.mode,
          outputDir: input.outputDir,
          profiles: {},
          runDirectory: `${input.outputDir}/${input.runId}`,
          runId: input.runId ?? PHASE59_CANONICAL_LIVE_RUN_ID,
          source: {
            benchmark: "ImplicitMemBench",
            license: "CC BY 4.0",
            url: "https://github.com/qinchonghanzuibang/ImplicitMemBench",
          },
          summary: {
              caseCountsByDataset: {
                classical_conditioning: 32,
                priming: 0,
                procedural_memory: 28,
              },
              caseCountsByScorer: {
                priming_pair_judge: 0,
                structured_first_action: 28,
                text_behavior_judge: 32,
              },
            executionFailures: 0,
            explicitRecallLeakCount: 0,
              passedBlockingCases: 48,
              primingAverageScore: 0,
              totalBlockingCases: 60,
              totalCases: 60,
          },
        };
      },
    });

    expect(report.mode).toBe("live");
    expect(receivedInput).toEqual({
      mode: "live",
      outputDir: resolvePhase59LiveMemoryOutputDir(process.cwd()),
      runId: PHASE59_CANONICAL_LIVE_RUN_ID,
    });
  });

  it("fails closed for transcript-only raw examples while retaining distilled coverage", async () => {
    const outputDir = await createTempDir("phase59-fallback");
    const report = await runPhase59Eval({
      outputDir,
      runId: "run-phase59-test",
    });

    expect(report.mode).toBe("smoke");
    expect(report.summary.executionFailures).toBe(0);
    expect(report.summary.totalBlockingCases).toBe(120);
    expect(report.summary.passedBlockingCases).toBe(60);
    expect(
      report.profiles["goodmemory-raw-experience"]?.totalBlockingCases,
    ).toBe(60);
    expect(
      report.profiles["goodmemory-raw-experience"]?.passedBlockingCases,
    ).toBe(0);
    expect(
      report.profiles["goodmemory-raw-experience"]?.cases.every(
        (caseResult) =>
          caseResult.rawCarryover?.abstainReason === "no_candidates" &&
          caseResult.rawCarryover.candidatePrototypeIds.length === 0 &&
          caseResult.rawCarryover.selectedPrototypeIds.length === 0,
      ),
    ).toBe(true);
    expect(
      report.profiles["goodmemory-distilled-feedback"]?.totalBlockingCases,
    ).toBe(60);
    expect(
      report.profiles["goodmemory-distilled-feedback"]?.passedBlockingCases,
    ).toBeGreaterThanOrEqual(56);

    const gate = await runPhase59Gate(
      {
        outputDir,
      },
      {
        ensureDir: async () => undefined,
        now: () => "2026-08-13T00:00:00.000Z",
        readTextFile: async () => JSON.stringify(report),
        runCommand: async () => ({
          durationMs: 1,
          exitCode: 0,
          stderr: "",
          stdout: "ok",
        }),
        writeTextFile: async () => undefined,
      },
    );

    expect(gate.acceptance).toEqual({
      decision: "accepted",
      reason:
        "Phase 59 transcript-only raw fixtures failed closed and the distilled profile passed the deterministic gate.",
    });
    expect(gate.runId).toBe(PHASE59_CANONICAL_GATE_RUN_ID);
    expect(gate.runId).not.toBe("run-20260504193000");
    expect(gate.evidence.rawInternalizationDiagnostics.byDiagnosis.memory_miss).toBe(60);
    expect(
      gate.evidence.rawInternalizationDiagnostics.byDiagnosis.selected_and_passed,
    ).toBe(0);
  });
});
