import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { applyDurableRerankingToResult } from "../src/api/recallReranking";
import type { RecallResult } from "../src/api/contracts";
import { createLanguageService } from "../src/language";
import {
  PHASE70_RERANKER_GATEWAY,
  PHASE70_RERANKER_MODEL,
  evaluatePhase70RerankerGate,
} from "./phase-70-reranker-contracts";
import type {
  Phase70FallbackProof,
  Phase70GateResult,
  Phase70RerankerEvalReport,
} from "./phase-70-reranker-contracts";
import {
  buildLocomoScope,
  createLocomoSmokeMemory,
} from "./run-phase-65-locomo-smoke";
import { parsePhase70SelectionManifest } from "./run-phase-70-reranker-eval";
import {
  resolveCliFlagValueStrict,
  resolveCliPathSegmentFlagValueStrict,
} from "./cli-options";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

const PHASE70_GATE_RUN_ID = "run-20260711-reranker-and-evidence";
const PHASE70_GATE_FILE_NAME = "phase-70-quality-gate.json";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicRecallDigest(result: RecallResult): string {
  return sha256(
    JSON.stringify({
      archives: result.archives.map((record) => record.id),
      episodes: result.episodes.map((record) => record.id),
      evidence: result.evidence.map((record) => record.id),
      facts: result.facts.map((record) => ({
        content: record.content,
        id: record.id,
      })),
      feedback: result.feedback.map((record) => record.id),
      hits: result.metadata.hits,
      journal: result.journal,
      packet: result.packet,
      preferences: result.preferences.map((record) => record.id),
      profile: result.profile?.userId ?? null,
      references: result.references.map((record) => record.id),
      routingDecision: result.metadata.routingDecision,
      workingMemory: result.workingMemory,
    }),
  );
}

export async function buildPhase70FallbackProof(): Promise<Phase70FallbackProof> {
  const memory = createLocomoSmokeMemory();
  const scope = buildLocomoScope({
    caseId: "fallback-probe",
    runId: "phase70-fallback-probe",
  });
  await memory.remember({
    annotations: [0, 1, 2].map((messageIndex) => ({
      confirmed: true,
      kindHint: "fact" as const,
      messageIndex,
      remember: "always" as const,
      verified: true,
    })),
    extractionStrategy: "rules-only",
    messages: [
      { content: "Migration alpha needs legal approval.", role: "user" },
      { content: "Migration beta needs security review.", role: "user" },
      { content: "Migration gamma needs a rollback plan.", role: "user" },
    ],
    scope,
  });
  const original = await memory.recall({
    query: "What does each migration need?",
    scope,
    strategy: "rules-only",
  });
  const fallback = await applyDurableRerankingToResult({
    language: createLanguageService(),
    query: "What does each migration need?",
    reranker: {
      async rerank() {
        throw new Error("phase70 deterministic fallback probe");
      },
    },
    result: original,
    target: {
      adapter: "provider",
      gateway: PHASE70_RERANKER_GATEWAY,
      model: PHASE70_RERANKER_MODEL,
      provider: "openai",
    },
  });
  const trace = fallback.metadata.retrievalTrace?.reranker;
  if (
    trace?.status !== "fallback" ||
    trace.fallbackReason !== "provider_error"
  ) {
    throw new Error("Phase 70 fallback probe did not enter provider fallback.");
  }
  return {
    fallbackReason: "provider_error",
    fallbackResultDigest: deterministicRecallDigest(fallback),
    originalResultDigest: deterministicRecallDigest(original),
    status: "fallback",
  };
}

function validateManifestPopulation(input: {
  manifestRaw: string;
  report: Phase70RerankerEvalReport;
}): string[] {
  const failures: string[] = [];
  const manifest = parsePhase70SelectionManifest(input.manifestRaw);
  const expected = new Map<string, "protection" | "target">([
    ...manifest.targetQuestionIds.map(
      (id) => [id, "target"] as const,
    ),
    ...manifest.protectionQuestionIds.map(
      (id) => [id, "protection"] as const,
    ),
  ]);
  const actual = new Map(
    input.report.rows.map((row) => [row.questionId, row.cohort] as const),
  );
  if (actual.size !== expected.size) {
    failures.push("report population does not match the selection manifest");
    return failures;
  }
  for (const [questionId, cohort] of expected) {
    if (actual.get(questionId) !== cohort) {
      failures.push(
        `report selection mismatch for ${questionId}: expected ${cohort}`,
      );
    }
  }
  return failures;
}

export async function runPhase70Gate(input: {
  reportPath: string;
  outputPath: string;
  now?: () => Date;
}): Promise<{
  evidence: {
    benchmark: Phase70RerankerEvalReport["benchmark"];
    benchmarkFingerprint: string;
    executionFailures: number;
    metric: Phase70RerankerEvalReport["metric"];
    model: Phase70RerankerEvalReport["model"];
    rowCount: number;
    runId: string;
    summary: Phase70RerankerEvalReport["summary"];
  };
  fallbackProof: Phase70FallbackProof;
  generatedAt: string;
  inputs: {
    reportPath: string;
    reportSha256: string;
    selectionManifestPath: string;
    selectionManifestSha256: string;
  };
  result: Phase70GateResult;
}> {
  const repoRoot = resolveRepoRootFromScriptUrl(import.meta.url);
  const reportPath = resolve(input.reportPath);
  const outputPath = resolve(input.outputPath);
  if (reportPath === outputPath) {
    throw new Error("Phase 70 gate output must differ from the eval report.");
  }
  const reportRaw = await readFile(reportPath, "utf8");
  const report = JSON.parse(reportRaw) as Phase70RerankerEvalReport;
  const manifestPath = resolve(repoRoot, report.selection.manifestPath);
  const manifestRaw = await readFile(manifestPath, "utf8");
  if (sha256(manifestRaw) !== report.selection.manifestSha256) {
    throw new Error("Phase 70 selection manifest SHA-256 does not match report.");
  }
  const fallbackProof = await buildPhase70FallbackProof();
  const evaluated = evaluatePhase70RerankerGate(report, fallbackProof);
  const populationFailures = validateManifestPopulation({ manifestRaw, report });
  const failures = [...evaluated.failures, ...populationFailures];
  const result: Phase70GateResult = {
    ...evaluated,
    failures,
    status: failures.length === 0 ? "passed" : "failed",
  };
  const artifact = {
    evidence: {
      benchmark: report.benchmark,
      benchmarkFingerprint: report.benchmarkFingerprint,
      executionFailures: report.executionFailures,
      metric: report.metric,
      model: report.model,
      rowCount: report.rows.length,
      runId: report.runId,
      summary: report.summary,
    },
    fallbackProof,
    generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    inputs: {
      reportPath: relative(repoRoot, reportPath),
      reportSha256: sha256(reportRaw),
      selectionManifestPath: relative(repoRoot, manifestPath),
      selectionManifestSha256: sha256(manifestRaw),
    },
    result,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

if (import.meta.main) {
  const repoRoot = resolveRepoRootFromScriptUrl(import.meta.url);
  const reportPath = resolveCliFlagValueStrict(process.argv, "--report");
  if (!reportPath) {
    throw new Error("--report is required.");
  }
  const runId =
    resolveCliPathSegmentFlagValueStrict(process.argv, "--run-id") ??
    PHASE70_GATE_RUN_ID;
  const outputDir =
    resolveCliFlagValueStrict(process.argv, "--output-dir") ??
    join(repoRoot, "reports", "quality-gates", "phase-70");
  const artifact = await runPhase70Gate({
    outputPath: join(outputDir, runId, PHASE70_GATE_FILE_NAME),
    reportPath,
  });
  process.stdout.write(`${JSON.stringify(artifact.result, null, 2)}\n`);
  if (artifact.result.status !== "passed") {
    process.exitCode = 1;
  }
}
