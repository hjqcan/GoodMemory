import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { CLICommandOutput, CLIResult, ParsedFlags } from "./contracts";
import {
  clipText,
  flagEnabled,
  formatCountBreakdown,
  formatCountLine,
  pathExists,
  renderOutput,
  requireFlag,
} from "./shared";

interface ProposalLifecycleTrace {
  experienceCount: number;
  experienceKindCounts?: Record<string, number>;
  proposalCount: number;
  proposalStatusCounts?: Record<string, number>;
  promotionCount: number;
  promotionDecisionCounts?: Record<string, number>;
  proposals: Array<{
    id: string;
    proposalType: string;
    status: string;
    summary: string;
    sourceExperienceIds: string[];
    linkedMemoryIds: string[];
    linkedArchiveIds: string[];
    linkedEvidenceIds: string[];
  }>;
  promotions: Array<{
    proposalId: string;
    decision: string;
    policyOutcome: string;
    verificationOutcome: string;
    evalOutcome: string;
  }>;
}

interface EvalInspectPayload {
  artifact: Record<string, unknown>;
  caseId: string;
  report: {
    mode?: string;
    runtime?: {
      generationMode?: string;
      judgeMode?: string;
    };
  };
}

interface EvalTracePayload {
  assertions: Record<string, unknown> | null;
  caseId: string;
  proposalTrace: ProposalLifecycleTrace | null;
  rawRecall: Record<string, unknown>;
  trace: Record<string, unknown>;
}
async function exportCaseArtifact(input: {
  caseId: string;
  force: boolean;
  outputPath: string;
  runDir: string;
}): Promise<void> {
  if ((await pathExists(input.outputPath)) && !input.force) {
    throw new Error(
      `Output path already exists: ${input.outputPath}. Pass --force to overwrite.`,
    );
  }

  if (input.force) {
    await rm(input.outputPath, { force: true });
  }

  await mkdir(dirname(input.outputPath), { recursive: true });
  await copyFile(
    join(input.runDir, "cases", `${input.caseId}.json`),
    input.outputPath,
  );
}

async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  try {
    return await readJson<T>(path);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}

async function inspectEvalCase(
  runDir: string,
  caseId: string,
): Promise<EvalInspectPayload> {
  return {
    artifact: await readJson<Record<string, unknown>>(
      join(runDir, "cases", `${caseId}.json`),
    ),
    caseId,
    report: await readJson<EvalInspectPayload["report"]>(join(runDir, "report.json")),
  };
}

function renderEvalInspectPayload(payload: EvalInspectPayload): string {
  const artifact = payload.artifact as {
    assertions?: {
      contaminationFindings?: string[];
      passedChecks?: number;
      totalChecks?: number;
      updateFindings?: string[];
    };
    goodmemory?: {
      retrieved?: {
        archives?: unknown[];
        episodes?: unknown[];
        evidence?: unknown[];
        facts?: unknown[];
        feedback?: unknown[];
        policyApplied?: string[];
        preferences?: unknown[];
        references?: unknown[];
      };
      trace?: {
        proposalLifecycle?: ProposalLifecycleTrace | null;
        recallHitCount?: number;
      };
    };
    judge: { winner: string };
    metadata?: {
      evaluationSetting?: string;
      memorySourceDomains?: string[];
      targetDomain?: string;
      taskFamily?: string;
    };
  };
  const retrieved = artifact.goodmemory?.retrieved;
  const proposalLifecycle = artifact.goodmemory?.trace?.proposalLifecycle ?? null;

  return [
    `Run Mode: ${payload.report.mode ?? "unknown"}`,
    `Runtime: generation=${payload.report.runtime?.generationMode ?? "unknown"}, judge=${
      payload.report.runtime?.judgeMode ?? "unknown"
    }`,
    `Case: ${payload.caseId}`,
    `Task Family: ${artifact.metadata?.taskFamily ?? "unknown"}`,
    `Setting: ${artifact.metadata?.evaluationSetting ?? "unknown"}`,
    `Target Domain: ${artifact.metadata?.targetDomain ?? "unknown"}`,
    `Memory Source Domains: ${
      artifact.metadata?.memorySourceDomains?.join(", ") ?? "unknown"
    }`,
    `Winner: ${artifact.judge.winner}`,
    `References: ${retrieved?.references?.length ?? 0}`,
    `Facts: ${retrieved?.facts?.length ?? 0}`,
    `Feedback: ${retrieved?.feedback?.length ?? 0}`,
    `Archives: ${retrieved?.archives?.length ?? 0}`,
    `Evidence: ${retrieved?.evidence?.length ?? 0}`,
    `Episodes: ${retrieved?.episodes?.length ?? 0}`,
    formatCountLine(
      "Experience Records",
      proposalLifecycle?.experienceCount,
      proposalLifecycle?.experienceKindCounts,
    ),
    formatCountLine(
      "Proposals",
      proposalLifecycle?.proposalCount,
      proposalLifecycle?.proposalStatusCounts,
    ),
    formatCountLine(
      "Promotions",
      proposalLifecycle?.promotionCount,
      proposalLifecycle?.promotionDecisionCounts,
    ),
    `Recall Hits: ${artifact.goodmemory?.trace?.recallHitCount ?? 0}`,
    `Assertions: ${
      artifact.assertions
        ? `${artifact.assertions.passedChecks ?? 0}/${artifact.assertions.totalChecks ?? 0} passed`
        : "unknown"
    }`,
    `Contamination Findings: ${
      artifact.assertions?.contaminationFindings?.length ?? 0
    }`,
    `Update Findings: ${artifact.assertions?.updateFindings?.length ?? 0}`,
    `Policy Applied: ${
      retrieved?.policyApplied?.length ? retrieved.policyApplied.join(", ") : "none"
    }`,
  ].join("\n");
}

async function traceEvalCase(
  runDir: string,
  caseId: string,
): Promise<EvalTracePayload> {
  const trace = await readJson<Record<string, unknown>>(
    join(runDir, "traces", caseId, "goodmemory.json"),
  );
  const rawRecall = await readJson<Record<string, unknown>>(
    join(runDir, "traces", caseId, "raw-recall.json"),
  );
  const assertions = await readOptionalJson<Record<string, unknown>>(
    join(runDir, "traces", caseId, "assertions.json"),
  );
  const proposalTrace =
    (await readOptionalJson<ProposalLifecycleTrace>(
      join(runDir, "traces", caseId, "proposal-trace.json"),
    )) ??
    ((trace.trace as { proposalLifecycle?: ProposalLifecycleTrace | null })
      ?.proposalLifecycle ??
      null);

  return {
    assertions,
    caseId,
    proposalTrace,
    rawRecall,
    trace,
  };
}

function renderEvalTracePayload(payload: EvalTracePayload): string {
  const trace = payload.trace as {
    trace: {
      rememberEvents: Array<{
        accepted: number;
        events?: Array<{ memoryType: string; reason?: string }>;
        rejected: number;
        sessionId: string;
      }>;
    };
  };
  const rawRecall = payload.rawRecall as {
    hits?: Array<{ evidenceIds?: string[]; reason?: string; type: string }>;
    policyApplied?: string[];
    routingDecision?: {
      strategy?: string;
      strategyExplanation?: { summary?: string };
    };
    verificationHints?: Array<{
      evidenceIds?: string[];
      memoryType: string;
      reason: string;
    }>;
  };
  const assertions = payload.assertions as
    | {
        checks: Array<{ details: string[]; id: string; passed: boolean }>;
        contaminationFindings: string[];
        updateFindings: string[];
      }
    | null;
  const proposalTrace = payload.proposalTrace;

  const writeLines = trace.trace.rememberEvents.flatMap((session) => {
    const header = `- ${session.sessionId}: accepted=${session.accepted}, rejected=${session.rejected}`;
    const events = (session.events ?? []).map(
      (event) => `  * ${event.memoryType}: ${event.reason ?? "no_reason"}`,
    );
    return [header, ...events];
  });

  const hitLines = (rawRecall.hits ?? []).map(
    (hit) =>
      `- ${hit.type}: ${hit.reason ?? "no_reason"}${
        hit.evidenceIds?.length ? ` [evidence=${hit.evidenceIds.join(",")}]` : ""
      }`,
  );
  const routerLines = rawRecall.routingDecision
    ? [
        `- strategy: ${rawRecall.routingDecision.strategy ?? "unknown"}`,
        `- explanation: ${
          rawRecall.routingDecision.strategyExplanation?.summary ?? "no_explanation"
        }`,
      ]
    : ["- unavailable"];
  const verificationLines = (rawRecall.verificationHints ?? []).map(
    (hint) =>
      `- ${hint.memoryType}: ${hint.reason}${
        hint.evidenceIds?.length ? ` [evidence=${hint.evidenceIds.join(",")}]` : ""
      }`,
  );
  const policyLines = (rawRecall.policyApplied ?? []).map((policy) => `- ${policy}`);
  const proposalLines = proposalTrace
    ? [
        `- experiences: ${proposalTrace.experienceCount}${
          formatCountBreakdown(proposalTrace.experienceKindCounts)
            ? ` [${formatCountBreakdown(proposalTrace.experienceKindCounts)}]`
            : ""
        }`,
        `- proposals: ${proposalTrace.proposalCount}${
          formatCountBreakdown(proposalTrace.proposalStatusCounts)
            ? ` [${formatCountBreakdown(proposalTrace.proposalStatusCounts)}]`
            : ""
        }`,
        ...proposalTrace.proposals.map(
          (proposal) =>
            `- ${proposal.proposalType} / ${proposal.status}: ${clipText(proposal.summary)} ` +
            `[source=${proposal.sourceExperienceIds.length} memory=${proposal.linkedMemoryIds.length} ` +
            `archive=${proposal.linkedArchiveIds.length} evidence=${proposal.linkedEvidenceIds.length}]`,
        ),
      ]
    : ["- unavailable"];
  const promotionLines = proposalTrace
    ? proposalTrace.promotions.map(
        (promotion) =>
          `- ${promotion.proposalId} -> ${promotion.decision} ` +
          `[policy=${promotion.policyOutcome} verification=${promotion.verificationOutcome} eval=${promotion.evalOutcome}]`,
      )
    : ["- unavailable"];
  const assertionLines = assertions
    ? assertions.checks.map(
        (check) =>
          `- ${check.id}: ${check.passed ? "pass" : "fail"} (${check.details.join(", ")})`,
      )
    : ["- unavailable (legacy run)"];

  return [
    "Write Trace",
    ...writeLines,
    "",
    "Recall Hits",
    ...hitLines,
    "",
    "Router Strategy",
    ...routerLines,
    "",
    "Verification Hints",
    ...(verificationLines.length > 0 ? verificationLines : ["- none"]),
    "",
    "Policy Applied",
    ...(policyLines.length > 0 ? policyLines : ["- none"]),
    "",
    "Proposal Lifecycle",
    ...(proposalLines.length > 0 ? proposalLines : ["- none"]),
    "",
    "Promotion Decisions",
    ...(promotionLines.length > 0 ? promotionLines : ["- none"]),
    "",
    "Assertions",
    ...assertionLines,
    "",
    "Contamination Findings",
    ...(assertions?.contaminationFindings.length
      ? assertions.contaminationFindings.map((finding) => `- ${finding}`)
      : ["- none"]),
    "",
    "Update Findings",
    ...(assertions?.updateFindings.length
      ? assertions.updateFindings.map((finding) => `- ${finding}`)
      : ["- none"]),
  ].join("\n");
}

async function handleEvalInspect(
  flags: ParsedFlags,
): Promise<CLICommandOutput> {
  const payload = await inspectEvalCase(
    requireFlag(flags, "run-dir"),
    requireFlag(flags, "case-id"),
  );
  return {
    json: payload,
    text: renderEvalInspectPayload(payload),
  };
}

async function handleEvalTrace(flags: ParsedFlags): Promise<CLICommandOutput> {
  const payload = await traceEvalCase(
    requireFlag(flags, "run-dir"),
    requireFlag(flags, "case-id"),
  );
  return {
    json: payload,
    text: renderEvalTracePayload(payload),
  };
}

async function handleEvalExportCase(
  flags: ParsedFlags,
): Promise<CLICommandOutput> {
  const runDir = requireFlag(flags, "run-dir");
  const caseId = requireFlag(flags, "case-id");
  const outputPath = resolve(requireFlag(flags, "output"));
  await exportCaseArtifact({
    caseId,
    force: flagEnabled(flags, "force"),
    outputPath,
    runDir,
  });

  const payload = {
    caseId,
    outputPath,
    runDir,
  };

  return {
    json: payload,
    text: `Exported case artifact to ${outputPath}`,
  };
}


export async function runEvalCommand(
  commands: string[],
  flags: ParsedFlags,
): Promise<CLIResult> {
  const secondary = commands[1];
  switch (secondary) {
    case "inspect":
      return renderOutput(await handleEvalInspect(flags), flags);
    case "trace":
      return renderOutput(await handleEvalTrace(flags), flags);
    case "export-case":
      return renderOutput(await handleEvalExportCase(flags), flags);
    default:
      throw new Error(`Unknown eval command: ${secondary}. Run 'goodmemory eval --help'.`);
  }
}
