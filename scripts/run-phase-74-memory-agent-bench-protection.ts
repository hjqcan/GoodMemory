import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  resolveCliFlagValueStrict,
  resolveCliPathSegmentFlagValueStrict,
} from "./cli-options";
import {
  runPhase74MemoryAgentBenchProtection,
  verifyPhase74MemoryAgentBenchProtectionArtifact,
} from "./phase-74-memory-agent-bench-protection";
import { resolveRepoRootFromScriptUrl } from "./script-paths";
import {
  capturePhase74EvaluatorSource,
} from "../src/eval/phase74Live";
import type {
  Phase74EvaluatorSource,
} from "../src/eval/phase74Live";
import type {
  Phase74ProtectionReplicate,
} from "../src/eval/phase74ProtectionContracts";
import type {
  Phase74ProtectionSuiteRunResult,
} from "../src/eval/phase74ProtectionRun";
import {
  parsePhase74MemoryAgentBenchDataset,
} from "../src/eval/phase74MemoryAgentBenchProtectionVerifier";
export {
  parsePhase74MemoryAgentBenchDataset,
} from "../src/eval/phase74MemoryAgentBenchProtectionVerifier";

export interface Phase74MemoryAgentBenchProtectionCliOptions {
  benchmarkRoot: string;
  datasetId: string;
  outputDir: string;
  replicate: Phase74ProtectionReplicate;
  runId: string;
}

export interface Phase74MemoryAgentBenchProtectionCliDependencies {
  captureEvaluatorSource?(input: {
    repoRoot: string;
  }): Promise<Phase74EvaluatorSource>;
  readDataset?(path: string): Promise<Uint8Array>;
  verifyProtectionArtifact?: typeof verifyPhase74MemoryAgentBenchProtectionArtifact;
}

function requiredFlag(args: readonly string[], flag: string): string {
  const value = resolveCliFlagValueStrict(args, flag);
  if (value === undefined || value === "" || value.trim() !== value) {
    throw new Error(`Phase 74 MemoryAgentBench protection requires ${flag}.`);
  }
  return value;
}

function replicateValue(value: string): Phase74ProtectionReplicate {
  if (value !== "1" && value !== "2" && value !== "3") {
    throw new Error("--replicate must be 1, 2, or 3.");
  }
  return Number(value) as Phase74ProtectionReplicate;
}

export function parsePhase74MemoryAgentBenchProtectionCliOptions(
  args: readonly string[],
): Phase74MemoryAgentBenchProtectionCliOptions {
  if (["--source-id", "--source-commit", "--source-sha256"].some((flag) =>
    args.includes(flag)
  )) {
    throw new Error(
      "Phase 74 protection source identity is computed from the checkout.",
    );
  }
  const runId = resolveCliPathSegmentFlagValueStrict(args, "--run-id");
  if (runId === undefined) {
    throw new Error(
      "Phase 74 MemoryAgentBench protection requires --run-id.",
    );
  }
  return {
    benchmarkRoot: resolve(requiredFlag(args, "--benchmark-root")),
    datasetId: requiredFlag(args, "--dataset-id"),
    outputDir: resolve(requiredFlag(args, "--output-dir")),
    replicate: replicateValue(requiredFlag(args, "--replicate")),
    runId,
  };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function runPhase74MemoryAgentBenchProtectionCli(
  options: Phase74MemoryAgentBenchProtectionCliOptions,
  dependencies: Phase74MemoryAgentBenchProtectionCliDependencies = {},
): Promise<Phase74ProtectionSuiteRunResult> {
  const evaluatorSource = await (
    dependencies.captureEvaluatorSource ?? capturePhase74EvaluatorSource
  )({ repoRoot: resolveRepoRootFromScriptUrl(import.meta.url) });
  const datasetPath = join(options.benchmarkRoot, "cases.json");
  const datasetBytes = await (dependencies.readDataset ?? readFile)(datasetPath);
  const cases = parsePhase74MemoryAgentBenchDataset(
    Buffer.from(datasetBytes).toString("utf8"),
    datasetPath,
  );
  const dataset = {
    id: options.datasetId,
    sha256: sha256(datasetBytes),
  };
  const source = {
    id: `git:${evaluatorSource.commit}`,
    sha256: evaluatorSource.sha256,
  };
  const runDirectory = join(options.outputDir, options.runId);
  const result = await runPhase74MemoryAgentBenchProtection({
    artifactPath: join(runDirectory, "protection-run.json"),
    cases,
    dataset,
    rawArtifactPath: join(runDirectory, "raw.json"),
    replicate: options.replicate,
    runId: options.runId,
    source,
  });
  await (
    dependencies.verifyProtectionArtifact ??
      verifyPhase74MemoryAgentBenchProtectionArtifact
  )({ artifactPath: result.artifactPath, cases, dataset, source });
  return result;
}

if (import.meta.main) {
  try {
    const result = await runPhase74MemoryAgentBenchProtectionCli(
      parsePhase74MemoryAgentBenchProtectionCliOptions(process.argv),
    );
    process.stdout.write(`${JSON.stringify({
      artifactPath: result.artifactPath,
      caseCount: result.artifact.rows.length,
      executionFailures: result.artifact.executionFailures,
      rawArtifactPath: result.rawArtifactPath,
      runId: result.artifact.runId,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Phase 74 MemoryAgentBench protection failed: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
