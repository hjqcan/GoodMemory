#!/usr/bin/env bun
import type {
  ImplicitMemBenchResearchReport,
  RunImplicitMemBenchGoodMemoryOptions,
} from "../src/eval/implicitmembench-research";
import { runImplicitMemBenchGoodMemoryEval } from "../src/eval/implicitmembench-research";
import {
  createPhase58SmokeDependencies,
  parsePhase58CliOptions,
  resolvePhase58AdapterManifestPath,
  resolvePhase58BenchmarkRoot,
  resolvePhase58FallbackOutputDir,
  resolvePhase58RepoRoot,
} from "./run-phase-58-shared";

const GENERATED_BY = "scripts/run-phase-58-eval.ts";
export const PHASE58_CANONICAL_RUN_ID = "run-phase58-typed-outcome-current";

export interface Phase58EvalDependencies {
  runEvaluation?: (
    input: RunImplicitMemBenchGoodMemoryOptions,
  ) => Promise<ImplicitMemBenchResearchReport>;
}

export async function runPhase58Eval(
  input?: Partial<ReturnType<typeof parsePhase58CliOptions>>,
  dependencies?: Phase58EvalDependencies,
): Promise<ImplicitMemBenchResearchReport> {
  const root = resolvePhase58RepoRoot();
  const runEvaluation =
    dependencies?.runEvaluation ?? runImplicitMemBenchGoodMemoryEval;

  return runEvaluation({
    benchmarkRoot: input?.benchmarkRoot ?? resolvePhase58BenchmarkRoot(root),
    dependencies: createPhase58SmokeDependencies(),
    generatedBy: GENERATED_BY,
    limit: input?.limit,
    manifestPath: resolvePhase58AdapterManifestPath(root),
    mode: "smoke",
    outputDir: input?.outputDir ?? resolvePhase58FallbackOutputDir(root),
    runId: input?.runId ?? PHASE58_CANONICAL_RUN_ID,
  });
}

async function main(): Promise<void> {
  const report = await runPhase58Eval(parsePhase58CliOptions(process.argv));
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  await main();
}
