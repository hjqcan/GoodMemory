import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runPhase63RecallDiagnosticAnalysis } from "./analyze-phase-63-recall-diagnostic";
import { resolvePhase63RepoRoot } from "./run-phase-63-shared";
import { SELECTION_REFACTOR_BASELINE_RUN_ID } from "./verify-selection-refactor";
// Side-effect import: loads the full selection module graph so every wrapped
// narrow gate registers before the census is taken.
import "./eval-profiles/legacy-fitted/recall/selectionLegacy";
import { listRegisteredNarrowGateIds } from "./eval-profiles/legacy-fitted/recall/narrowGates";

export interface NarrowGateAuditOptions {
  baselineRunId?: string;
  batchSize?: number;
  benchmarkRoot?: string;
  gates?: string[];
  maxRuns?: number;
}

export type NarrowGateStatus =
  | "dead"
  | "dead_batch_attested"
  | "case_fitted"
  | "load_bearing";

export interface NarrowGateVerdict {
  affectedQuestionIds: string[];
  caseDeltaCount: number;
  gateId: string;
  status: NarrowGateStatus;
}

interface BatchResult {
  affectedQuestionIds: string[];
  caseDeltaCount: number;
  gates: string[];
  runId: string;
}

interface AuditState {
  baselineRunId: string;
  batches: Record<string, BatchResult>;
  runsExecuted: number;
}

export function chunkGatesByFamily(
  gateIds: readonly string[],
  batchSize: number,
): string[][] {
  const byFamily = new Map<string, string[]>();
  for (const id of [...gateIds].sort()) {
    const family = id.split(".")[0] ?? "misc";
    const bucket = byFamily.get(family) ?? [];
    bucket.push(id);
    byFamily.set(family, bucket);
  }

  const batches: string[][] = [];
  for (const ids of byFamily.values()) {
    for (let index = 0; index < ids.length; index += batchSize) {
      batches.push(ids.slice(index, index + batchSize));
    }
  }
  return batches;
}

export function classifySingleton(result: {
  affectedQuestionIds: string[];
  caseDeltaCount: number;
  gateId: string;
}): NarrowGateVerdict {
  const status: NarrowGateStatus = result.caseDeltaCount === 0
    ? "dead"
    : result.caseDeltaCount <= 1
      ? "case_fitted"
      : "load_bearing";
  return {
    affectedQuestionIds: result.affectedQuestionIds,
    caseDeltaCount: result.caseDeltaCount,
    gateId: result.gateId,
    status,
  };
}

function batchKey(gates: readonly string[]): string {
  return gates.join(",");
}

function runIdForBatch(gates: readonly string[], index: number): string {
  const family = gates[0]?.split(".")[0] ?? "misc";
  return `narrow-gate-audit-${family}-${index}-${gates.length}`;
}

async function runDisabledDiagnostic(input: {
  baselineRunId: string;
  benchmarkRoot: string;
  gates: readonly string[];
  runId: string;
}): Promise<BatchResult> {
  const child = Bun.spawn(
    [
      "bun",
      "run",
      "scripts/run-phase-63-beam-recall-diagnostic.ts",
      "--benchmark-root",
      input.benchmarkRoot,
      "--scale",
      "100K",
      "--profile",
      "goodmemory-rules-only",
      "--legacy-fitted-profile",
      "--run-id",
      input.runId,
    ],
    {
      cwd: resolvePhase63RepoRoot(),
      env: {
        ...process.env,
        GOODMEMORY_DISABLED_NARROW_GATES: input.gates.join(","),
      },
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(child.stderr).text();
    throw new Error(
      `diagnostic for ${input.runId} exited ${exitCode}: ${stderr.slice(-400)}`,
    );
  }

  const { analysis } = await runPhase63RecallDiagnosticAnalysis({
    baselineRunId: input.baselineRunId,
    benchmarkRoot: input.benchmarkRoot,
    runId: input.runId,
  });
  const caseDeltas = analysis.caseDeltas ?? [];
  return {
    affectedQuestionIds: caseDeltas.map(
      (delta: { questionId: string }) => delta.questionId,
    ),
    caseDeltaCount: caseDeltas.length,
    gates: [...input.gates],
    runId: input.runId,
  };
}

export async function runNarrowGateAudit(
  options: NarrowGateAuditOptions = {},
): Promise<{ reportPath: string; verdicts: NarrowGateVerdict[] }> {
  const baselineRunId =
    options.baselineRunId ?? SELECTION_REFACTOR_BASELINE_RUN_ID;
  const benchmarkRoot = options.benchmarkRoot ?? "/private/tmp/BEAM";
  const batchSize = options.batchSize ?? 12;
  const maxRuns = options.maxRuns ?? 40;
  const gateIds = options.gates ?? listRegisteredNarrowGateIds();

  const root = resolvePhase63RepoRoot();
  const auditDir = join(root, "reports/phase-63/narrow-gate-audit");
  await mkdir(auditDir, { recursive: true });
  const statePath = join(auditDir, "state.json");
  let state: AuditState = {
    baselineRunId,
    batches: {},
    runsExecuted: 0,
  };
  try {
    const existing = JSON.parse(await readFile(statePath, "utf8")) as AuditState;
    if (existing.baselineRunId === baselineRunId) {
      state = existing;
    }
  } catch {
    // fresh state
  }

  let auditRunIndex = Object.keys(state.batches).length;
  const measure = async (gates: readonly string[]): Promise<BatchResult> => {
    const key = batchKey(gates);
    const cached = state.batches[key];
    if (cached) {
      return cached;
    }
    if (state.runsExecuted >= maxRuns) {
      throw new Error(`run budget (${maxRuns}) exhausted; resume later`);
    }
    auditRunIndex += 1;
    const result = await runDisabledDiagnostic({
      baselineRunId,
      benchmarkRoot,
      gates,
      runId: runIdForBatch(gates, auditRunIndex),
    });
    state.batches[key] = result;
    state.runsExecuted += 1;
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    console.log(
      `[audit] ${result.runId}: gates=${gates.length} caseDeltas=${result.caseDeltaCount}`,
    );
    return result;
  };

  const verdicts: NarrowGateVerdict[] = [];
  const resolveBatch = async (gates: readonly string[]): Promise<void> => {
    const result = await measure(gates);
    if (result.caseDeltaCount === 0) {
      for (const gateId of gates) {
        verdicts.push({
          affectedQuestionIds: [],
          caseDeltaCount: 0,
          gateId,
          status: gates.length === 1 ? "dead" : "dead_batch_attested",
        });
      }
      return;
    }

    if (gates.length === 1) {
      verdicts.push(
        classifySingleton({
          affectedQuestionIds: result.affectedQuestionIds,
          caseDeltaCount: result.caseDeltaCount,
          gateId: gates[0]!,
        }),
      );
      return;
    }

    const midpoint = Math.ceil(gates.length / 2);
    await resolveBatch(gates.slice(0, midpoint));
    await resolveBatch(gates.slice(midpoint));
  };

  for (const batch of chunkGatesByFamily(gateIds, batchSize)) {
    await resolveBatch(batch);
  }

  verdicts.sort((left, right) => {
    if (left.status !== right.status) {
      return left.status.localeCompare(right.status);
    }
    return left.gateId.localeCompare(right.gateId);
  });
  const reportPath = join(auditDir, "report.json");
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        baselineRunId,
        generatedBy: "scripts/audit-narrow-gates.ts",
        note:
          "dead_batch_attested gates passed only as part of a clean batch; confirm individually before deletion. Negated call sites widen when disabled — review polarity manually for composite gates.",
        runsExecuted: state.runsExecuted,
        verdicts,
      },
      null,
      2,
    )}\n`,
  );

  const summary = new Map<NarrowGateStatus, number>();
  for (const verdict of verdicts) {
    summary.set(verdict.status, (summary.get(verdict.status) ?? 0) + 1);
  }
  console.log(`[audit] complete: ${JSON.stringify([...summary.entries()])}`);
  console.log(`[audit] report: ${reportPath}`);
  return { reportPath, verdicts };
}

function parseCliOptions(argv: readonly string[]): NarrowGateAuditOptions {
  const readFlag = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const gates = readFlag("--gates");
  const batchSize = readFlag("--batch-size");
  const maxRuns = readFlag("--max-runs");
  return {
    baselineRunId: readFlag("--baseline-run-id"),
    batchSize: batchSize ? Number(batchSize) : undefined,
    benchmarkRoot: readFlag("--benchmark-root"),
    gates: gates ? gates.split(",").map((value) => value.trim()) : undefined,
    maxRuns: maxRuns ? Number(maxRuns) : undefined,
  };
}

if (import.meta.main) {
  await runNarrowGateAudit(parseCliOptions(Bun.argv));
}
