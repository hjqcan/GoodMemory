import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImplicitMemBenchResearchDependencies } from "../../src/eval/implicitmembench-research";
import { runPhase58Eval } from "../../scripts/run-phase-58-eval";
import {
  PHASE58_CANONICAL_GATE_RUN_ID,
  runPhase58Gate,
} from "../../scripts/run-phase-58-gate";
import {
  PHASE58_CANONICAL_LIVE_RUN_ID,
  runPhase58LiveMemoryEval,
} from "../../scripts/run-phase-58-live-memory";
import {
  parsePhase58CliOptions,
  resolvePhase58AdapterManifestPath,
  resolvePhase58BenchmarkRoot,
  resolvePhase58FallbackOutputDir,
  resolvePhase58FixtureRoot,
  resolvePhase58LiveMemoryOutputDir,
} from "../../scripts/run-phase-58-shared";

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

describe("run-phase-58 scripts", () => {
  it("resolves phase-58 fixture and output directories", () => {
    expect(resolvePhase58FixtureRoot("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/fixtures/implicitmembench-phase-58",
    );
    expect(resolvePhase58BenchmarkRoot("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/fixtures/implicitmembench-phase-58",
    );
    expect(resolvePhase58AdapterManifestPath("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/fixtures/implicitmembench-phase-58/adapter-manifest.json",
    );
    expect(resolvePhase58FallbackOutputDir("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/eval/fallback/phase-58",
    );
    expect(resolvePhase58LiveMemoryOutputDir("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/eval/live-memory/phase-58",
    );
  });

  it("parses phase-58 cli flags", () => {
    expect(
      parsePhase58CliOptions([
        "bun",
        "run",
        "scripts/run-phase-58-eval.ts",
        "--benchmark-root",
        "/tmp/bench",
        "--output-dir",
        "/tmp/out",
        "--run-id",
        "run-phase58",
        "--limit",
        "50",
      ]),
    ).toEqual({
      benchmarkRoot: "/tmp/bench",
      limit: 50,
      outputDir: "/tmp/out",
      runId: "run-phase58",
      smoke: false,
    });
  });

  it("runs phase-58 fallback eval through the targeted fixture root", async () => {
    let receivedInput:
      | {
          benchmarkRoot: string;
          generatedBy: string;
          manifestPath: string;
          mode: string;
          outputDir: string;
        }
      | undefined;

    const report = await runPhase58Eval(
      {
        limit: 50,
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
            runDirectory: `${input.outputDir}/run-phase58`,
            runId: input.runId ?? "run-phase58",
            source: {
              benchmark: "ImplicitMemBench",
              license: "CC BY 4.0",
              url: "https://github.com/qinchonghanzuibang/ImplicitMemBench",
            },
            summary: {
              caseCountsByDataset: {
                classical_conditioning: 40,
                priming: 0,
                procedural_memory: 10,
              },
              caseCountsByScorer: {
                priming_pair_judge: 0,
                structured_first_action: 5,
                text_behavior_judge: 45,
              },
              executionFailures: 0,
              explicitRecallLeakCount: 0,
              passedBlockingCases: 44,
              primingAverageScore: 0,
              totalBlockingCases: 50,
              totalCases: 50,
            },
          };
        },
      },
    );

    expect(report.kind).toBe("goodmemory");
    expect(receivedInput?.mode).toBe("smoke");
    expect(receivedInput?.benchmarkRoot).toContain(
      "/fixtures/implicitmembench-phase-58",
    );
    expect(receivedInput?.manifestPath).toContain(
      "/fixtures/implicitmembench-phase-58/adapter-manifest.json",
    );
    expect(receivedInput?.generatedBy).toBe("scripts/run-phase-58-eval.ts");
  });

  it("runs phase-58 live-memory eval with canonical live run id by default", async () => {
    let receivedInput:
      | {
          mode: string;
          outputDir: string;
          runId: string | undefined;
        }
      | undefined;

    const report = await runPhase58LiveMemoryEval(undefined, {
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
          runId: input.runId ?? PHASE58_CANONICAL_LIVE_RUN_ID,
          source: {
            benchmark: "ImplicitMemBench",
            license: "CC BY 4.0",
            url: "https://github.com/qinchonghanzuibang/ImplicitMemBench",
          },
          summary: {
              caseCountsByDataset: {
                classical_conditioning: 40,
                priming: 0,
                procedural_memory: 10,
              },
              caseCountsByScorer: {
                priming_pair_judge: 0,
                structured_first_action: 5,
                text_behavior_judge: 45,
              },
            executionFailures: 0,
            explicitRecallLeakCount: 0,
              passedBlockingCases: 48,
              primingAverageScore: 0,
              totalBlockingCases: 50,
              totalCases: 50,
          },
        };
      },
    });

    expect(report.mode).toBe("live");
    expect(receivedInput).toEqual({
      mode: "live",
      outputDir: resolvePhase58LiveMemoryOutputDir(process.cwd()),
      runId: PHASE58_CANONICAL_LIVE_RUN_ID,
    });
  });

  it("fails closed for transcript-only raw examples while retaining distilled coverage", async () => {
    const outputDir = await createTempDir("phase58-fallback");
    const report = await runPhase58Eval({
      outputDir,
      runId: "run-phase58-test",
    });

    expect(report.mode).toBe("smoke");
    expect(report.summary.executionFailures).toBe(0);
    expect(report.summary.totalBlockingCases).toBe(100);
    expect(report.summary.passedBlockingCases).toBe(76);
    expect(
      report.profiles["goodmemory-raw-experience"]?.totalBlockingCases,
    ).toBe(50);
    expect(
      report.profiles["goodmemory-raw-experience"]?.passedBlockingCases,
    ).toBe(28);
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
    ).toBe(50);
    expect(
      report.profiles["goodmemory-distilled-feedback"]?.passedBlockingCases,
    ).toBeGreaterThanOrEqual(48);

    const gate = await runPhase58Gate(
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
        "Phase 58 transcript-only raw fixtures produced no carryover candidates and the distilled profile passed the deterministic gate.",
    });
    expect(gate.runId).toBe(PHASE58_CANONICAL_GATE_RUN_ID);
    expect(gate.runId).not.toBe("run-20260504183000");
    expect(gate.evidence.rawInternalizationDiagnostics.byDiagnosis.memory_miss).toBe(50);
    expect(
      gate.evidence.rawInternalizationDiagnostics.byDiagnosis.selected_and_passed,
    ).toBe(0);
  });
});
