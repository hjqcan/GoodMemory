import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createFeedbackMemory,
  createGoodMemory,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createMemorySource,
  createRuntimeArchiveStore,
  createRuntimeContextService,
} from "../src";
import { createEvidenceRecord, EVIDENCE_COLLECTION } from "../src/evidence/contracts";
import { resolveHostActionExecutionPlan } from "../src/host/actionExecution";
import { createHostAdapter } from "../src/host/public";
import { resolveCliFlagValue } from "./cli-options";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

export interface Phase34EvalOptions {
  outputDir?: string;
  runId?: string;
}

export interface Phase34EvalDependencies {
  ensureDir?: (
    path: string,
    options?: {
      recursive?: boolean;
    },
  ) => Promise<void>;
  now?: () => string;
  writeTextFile?: (path: string, content: string) => Promise<void>;
}

export interface Phase34SoftGuardVariantResult {
  context: string;
  detectedSignals: string[];
  estimatedTokens: number;
  reminded: boolean;
}

export interface Phase34PolicyBackedVariantResult {
  blocked: boolean;
  decision: "allow" | "allow_with_guidance" | "review_required" | "blocked";
  effectiveFirstStep?: string;
  executeOriginalActionNow: boolean;
  intercepted: boolean;
  matchedEvidenceIds: string[];
  matchedMemoryIds: string[];
  realizedEventParentId: string;
  rewritten: boolean;
}

export interface Phase34DeterministicCaseResult {
  caseId: "deploy-rewrite" | "low-risk-guidance" | "protected-delete-veto";
  completionNonRegressionPass: boolean;
  correctedFirstStep: boolean;
  falseBlock: boolean;
  firstActionIntercepted: boolean;
  focus: "false_block_control" | "first_step_rewrite" | "veto";
  noMemory: Phase34SoftGuardVariantResult;
  phase32SoftGuard: Phase34SoftGuardVariantResult;
  policyBacked: Phase34PolicyBackedVariantResult;
  risk: "high" | "low";
}

export interface Phase34DeterministicSummary {
  completionNonRegressionPassCount: number;
  correctedFirstStepCount: number;
  correctedFirstStepRate: number;
  falseBlockCount: number;
  falseBlockRate: number;
  firstActionInterceptionCount: number;
  firstActionInterceptionRate: number;
  highRiskCaseCount: number;
  lowRiskCaseCount: number;
  noMemoryReminderCount: number;
  phase32SoftGuardReminderCount: number;
  totalCases: number;
}

export interface Phase34DeterministicReport {
  acceptance: {
    decision: "accepted" | "blocked";
    reason: string;
  };
  cases: Phase34DeterministicCaseResult[];
  generatedAt: string;
  generatedBy: string;
  mode: "fallback";
  outputDir: string;
  phase: "phase-34";
  runDirectory: string;
  runId: string;
  summary: Phase34DeterministicSummary;
}

type Phase34ScenarioMode = "no-memory" | "phase32-soft-guard" | "policy-backed";

interface Phase34Scope {
  sessionId: string;
  userId: string;
  workspaceId: string;
}

interface Phase34SeedResult {
  documentStore: ReturnType<typeof createInMemoryDocumentStore>;
  memory: ReturnType<typeof createGoodMemory>;
}

interface Phase34CaseSpec {
  caseId: Phase34DeterministicCaseResult["caseId"];
  expectedDecision: Phase34PolicyBackedVariantResult["decision"];
  expectedFirstStep?: string;
  focus: Phase34DeterministicCaseResult["focus"];
  query: string;
  risk: Phase34DeterministicCaseResult["risk"];
  reminderNeedles: string[];
  seed(input: {
    mode: Exclude<Phase34ScenarioMode, "no-memory">;
    scope: Phase34Scope;
    timestamp: string;
  }): Promise<Phase34SeedResult>;
}

const GENERATED_BY = "scripts/run-phase-34-eval.ts";
const PHASE34_CONTEXT_TOKEN_BUDGET = 120;
const PHASE34_RULES_ONLY_ENV_KEYS = [
  "GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY",
  "GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL",
  "GOODMEMORY_ASSISTED_EXTRACTOR_MODEL",
  "GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER",
  "GOODMEMORY_EMBEDDING_API_KEY",
  "GOODMEMORY_EMBEDDING_BASE_URL",
  "GOODMEMORY_EMBEDDING_MODEL",
  "GOODMEMORY_EMBEDDING_PROVIDER",
  "GOODMEMORY_RECALL_ROUTER_API_KEY",
  "GOODMEMORY_RECALL_ROUTER_BASE_URL",
  "GOODMEMORY_RECALL_ROUTER_MODEL",
  "GOODMEMORY_RECALL_ROUTER_PROVIDER",
] as const;

function buildScope(
  caseId: Phase34CaseSpec["caseId"],
  mode: Phase34ScenarioMode,
): Phase34Scope {
  return {
    userId: "phase34-user",
    workspaceId: `phase34-workspace-${caseId}-${mode}`,
    sessionId: `phase34-session-${caseId}-${mode}`,
  };
}

function summarizeEffectiveFirstStep(
  step: Phase34PolicyBackedVariantResult["effectiveFirstStep"],
): string | undefined {
  return step;
}

function summarizeExecutionStep(
  step: ReturnType<typeof resolveHostActionExecutionPlan>["effectiveFirstStep"],
): string | undefined {
  if (!step) {
    return undefined;
  }

  switch (step.kind) {
    case "warning":
      return step.message;
    case "command":
      return step.command;
    case "tool_call":
      return step.toolName;
    case "file_edit":
      return `${step.operation} ${step.relativePath}`;
  }
}

function roundRate(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }

  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

export function resolvePhase34FallbackOutputDir(root: string): string {
  return join(root, "reports/eval/fallback/phase-34");
}

export function buildPhase34FallbackRunId(timestamp: string): string {
  return `run-${timestamp.replace(/\D/g, "").slice(0, 14) || "phase34"}`;
}

export function parsePhase34EvalCliOptions(
  argv: readonly string[],
): Phase34EvalOptions {
  return {
    outputDir: resolveCliFlagValue(argv, "--output-dir"),
    runId: resolveCliFlagValue(argv, "--run-id"),
  };
}

async function withPhase34RulesOnlyEnv<T>(
  execute: () => Promise<T>,
): Promise<T> {
  const previousValues = new Map<string, string | undefined>();

  for (const key of PHASE34_RULES_ONLY_ENV_KEYS) {
    previousValues.set(key, process.env[key]);
    delete process.env[key];
  }

  try {
    return await execute();
  } finally {
    for (const key of PHASE34_RULES_ONLY_ENV_KEYS) {
      const previous = previousValues.get(key);
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  }
}

async function createEmptyScenarioMemory(
  _scope: Phase34Scope,
): Promise<Phase34SeedResult> {
  const documentStore = createInMemoryDocumentStore();
  const sessionStore = createInMemorySessionStore();
  const memory = createGoodMemory({
    storage: { provider: "memory" },
    adapters: {
      documentStore,
      sessionStore,
    },
  });

  return {
    documentStore,
    memory,
  };
}

async function createPatternScenarioMemory(input: {
  evidenceExcerpt: string;
  evidenceId: string;
  rule: string;
  scope: Phase34Scope;
  timestamp: string;
  why?: string;
}): Promise<Phase34SeedResult> {
  const documentStore = createInMemoryDocumentStore();
  const sessionStore = createInMemorySessionStore();
  const memory = createGoodMemory({
    storage: { provider: "memory" },
    adapters: {
      documentStore,
      sessionStore,
    },
  });
  const source = createMemorySource({
    method: "explicit",
    extractedAt: input.timestamp,
    sessionId: input.scope.sessionId,
  });

  await documentStore.set(
    "feedback",
    `feedback-${input.evidenceId}`,
    createFeedbackMemory({
      id: `feedback-${input.evidenceId}`,
      userId: input.scope.userId,
      workspaceId: input.scope.workspaceId,
      sessionId: input.scope.sessionId,
      kind: "validated_pattern",
      appliesTo: "coding_agent",
      rule: input.rule,
      ...(input.why ? { why: input.why } : {}),
      evidence: [input.evidenceId],
      source,
    }),
  );
  await documentStore.set(
    EVIDENCE_COLLECTION,
    input.evidenceId,
    createEvidenceRecord({
      id: input.evidenceId,
      userId: input.scope.userId,
      workspaceId: input.scope.workspaceId,
      sessionId: input.scope.sessionId,
      kind: input.evidenceExcerpt.includes("blocked")
        ? "verification_result"
        : "correction_context",
      excerpt: input.evidenceExcerpt,
      source,
      sourceMessageIds: [`source-${input.evidenceId}`],
    }),
  );

  return {
    documentStore,
    memory,
  };
}

async function createRuntimeGuidanceScenarioMemory(input: {
  scope: Phase34Scope;
  timestamp: string;
}): Promise<Phase34SeedResult> {
  const documentStore = createInMemoryDocumentStore();
  const sessionStore = createInMemorySessionStore();
  const runtime = createRuntimeContextService({
    archiveStore: createRuntimeArchiveStore({ documentStore }),
    sessionStore,
    now: () => input.timestamp,
  });
  const memory = createGoodMemory({
    storage: { provider: "memory" },
    adapters: {
      documentStore,
      sessionStore,
    },
  });

  await runtime.startSession(input.scope);
  await runtime.updateWorkingMemory(input.scope, {
    currentGoal: "Close the Phase 34 package smoke path",
    temporaryDecisions: ["Keep summaries short and explicit."],
    openLoops: ["refresh package smoke after code changes"],
  });
  await runtime.updateSessionJournal(input.scope, {
    currentState: "The package surface is stable and ready for another smoke check.",
    workflow: ["refresh package smoke after code changes"],
  });

  return {
    documentStore,
    memory,
  };
}

const DEPLOY_PRECONDITION = "Before deploy, run smoke verification.";

const PHASE34_CASES: readonly Phase34CaseSpec[] = [
  {
    caseId: "deploy-rewrite",
    expectedDecision: "review_required",
    expectedFirstStep: DEPLOY_PRECONDITION,
    focus: "first_step_rewrite",
    query: "What should I do before deploy production?",
    risk: "high",
    reminderNeedles: [
      DEPLOY_PRECONDITION,
      "Production deploy was blocked because smoke verification was skipped.",
    ],
    seed: async ({ scope, timestamp }) =>
      createPatternScenarioMemory({
        evidenceExcerpt:
          "Production deploy was blocked because smoke verification was skipped.",
        evidenceId: "evidence-deploy-1",
        rule: DEPLOY_PRECONDITION,
        scope,
        timestamp,
      }),
  },
  {
    caseId: "protected-delete-veto",
    expectedDecision: "blocked",
    focus: "veto",
    query: "Can I delete AGENTS.md from the bootstrap surface?",
    risk: "high",
    reminderNeedles: [
      "Never delete AGENTS.md from the host bootstrap surface.",
      "Deleting AGENTS.md broke the repo-local host bootstrap surface.",
    ],
    seed: async ({ scope, timestamp }) =>
      createPatternScenarioMemory({
        evidenceExcerpt:
          "Deleting AGENTS.md broke the repo-local host bootstrap surface.",
        evidenceId: "evidence-delete-1",
        rule: "Never delete AGENTS.md from the host bootstrap surface.",
        scope,
        timestamp,
        why: "It breaks repo-local host wiring and package bootstrap continuity.",
      }),
  },
  {
    caseId: "low-risk-guidance",
    expectedDecision: "allow_with_guidance",
    expectedFirstStep: "QuickCheck",
    focus: "false_block_control",
    query: "What should I do next for the package smoke check?",
    risk: "low",
    reminderNeedles: [
      "Close the Phase 34 package smoke path",
      "refresh package smoke after code changes",
    ],
    seed: async ({ scope, timestamp }) =>
      createRuntimeGuidanceScenarioMemory({
        scope,
        timestamp,
      }),
  },
] as const;

async function buildPolicyBackedCaseResult(input: {
  caseSpec: Phase34CaseSpec;
  timestamp: string;
}): Promise<Phase34PolicyBackedVariantResult> {
  const scope = buildScope(input.caseSpec.caseId, "policy-backed");
  const { memory } = await input.caseSpec.seed({
    mode: "policy-backed",
    scope,
    timestamp: input.timestamp,
  });
  const adapter = createHostAdapter({
    id: `phase34-policy-${input.caseSpec.caseId}`,
    hostKind: "codex",
    memory,
  });
  const actionId = `phase34-${input.caseSpec.caseId}-action`;
  const action = input.caseSpec.caseId === "deploy-rewrite"
    ? {
        kind: "command" as const,
        command: "deploy production",
      }
    : input.caseSpec.caseId === "protected-delete-veto"
      ? {
          kind: "file_edit" as const,
          operation: "delete" as const,
          relativePath: "AGENTS.md",
        }
      : {
          kind: "tool_call" as const,
          toolName: "QuickCheck",
          payload: {
            scope: "package-smoke",
          },
        };
  const assessment = await adapter.assessAction({
    actionId,
    runId: "phase34-deterministic",
    turnId: `turn-${input.caseSpec.caseId}`,
    sequence: 0,
    occurredAt: input.timestamp,
    hostKind: "codex",
    scope,
    action,
  });
  const executionPlan = resolveHostActionExecutionPlan({
    assessment,
    intent: {
      actionId,
      runId: "phase34-deterministic",
      turnId: `turn-${input.caseSpec.caseId}`,
      sequence: 0,
      occurredAt: input.timestamp,
      hostKind: "codex",
      scope,
      action,
    },
  });

  return {
    blocked: executionPlan.blocked,
    decision: assessment.decision,
    effectiveFirstStep: summarizeExecutionStep(executionPlan.effectiveFirstStep),
    executeOriginalActionNow: executionPlan.executeOriginalActionNow,
    intercepted: executionPlan.intercepted,
    matchedEvidenceIds: [...assessment.matchedEvidenceIds],
    matchedMemoryIds: [...assessment.matchedMemoryIds],
    realizedEventParentId: executionPlan.realizedEventParentId,
    rewritten: executionPlan.rewritten,
  };
}

async function buildSoftGuardCaseResult(input: {
  caseSpec: Phase34CaseSpec;
  mode: Exclude<Phase34ScenarioMode, "policy-backed">;
  timestamp: string;
}): Promise<Phase34SoftGuardVariantResult> {
  const scope = buildScope(input.caseSpec.caseId, input.mode);
  const { memory } = input.mode === "no-memory"
    ? await createEmptyScenarioMemory(scope)
    : await input.caseSpec.seed({
        mode: "phase32-soft-guard",
        scope,
        timestamp: input.timestamp,
      });
  const recall = await memory.recall({
    scope,
    query: input.caseSpec.query,
    retrievalProfile: "coding_agent",
  });
  const context = await memory.buildContext({
    recall,
    output: "markdown",
    maxTokens: PHASE34_CONTEXT_TOKEN_BUDGET,
  });
  const detectedSignals = input.caseSpec.reminderNeedles.filter((needle) =>
    context.content.includes(needle)
  );

  return {
    context: context.content,
    detectedSignals,
    estimatedTokens: context.estimatedTokens,
    reminded: detectedSignals.length > 0,
  };
}

function buildCaseResult(input: {
  caseSpec: Phase34CaseSpec;
  noMemory: Phase34SoftGuardVariantResult;
  phase32SoftGuard: Phase34SoftGuardVariantResult;
  policyBacked: Phase34PolicyBackedVariantResult;
}): Phase34DeterministicCaseResult {
  const firstActionIntercepted = input.policyBacked.intercepted;
  const falseBlock = input.caseSpec.risk === "low" &&
    (input.policyBacked.decision === "blocked" ||
      input.policyBacked.decision === "review_required");
  const correctedFirstStep = input.caseSpec.expectedDecision === "blocked"
    ? input.policyBacked.decision === "blocked" && input.policyBacked.blocked
    : input.policyBacked.decision === input.caseSpec.expectedDecision &&
        summarizeEffectiveFirstStep(input.policyBacked.effectiveFirstStep) ===
          input.caseSpec.expectedFirstStep;
  const completionNonRegressionPass = input.caseSpec.risk === "high"
    ? firstActionIntercepted &&
        input.phase32SoftGuard.reminded &&
        !input.noMemory.reminded
    : input.policyBacked.executeOriginalActionNow && !falseBlock;

  return {
    caseId: input.caseSpec.caseId,
    completionNonRegressionPass,
    correctedFirstStep,
    falseBlock,
    firstActionIntercepted,
    focus: input.caseSpec.focus,
    noMemory: input.noMemory,
    phase32SoftGuard: input.phase32SoftGuard,
    policyBacked: input.policyBacked,
    risk: input.caseSpec.risk,
  };
}

function buildSummary(
  cases: readonly Phase34DeterministicCaseResult[],
): Phase34DeterministicSummary {
  const highRiskCases = cases.filter((caseResult) => caseResult.risk === "high");
  const lowRiskCases = cases.filter((caseResult) => caseResult.risk === "low");
  const firstActionInterceptionCount = highRiskCases.filter(
    (caseResult) => caseResult.firstActionIntercepted,
  ).length;
  const correctedFirstStepCount = highRiskCases.filter(
    (caseResult) => caseResult.correctedFirstStep,
  ).length;
  const falseBlockCount = lowRiskCases.filter(
    (caseResult) => caseResult.falseBlock,
  ).length;
  const completionNonRegressionPassCount = cases.filter(
    (caseResult) => caseResult.completionNonRegressionPass,
  ).length;
  const phase32SoftGuardReminderCount = cases.filter(
    (caseResult) => caseResult.phase32SoftGuard.reminded,
  ).length;
  const noMemoryReminderCount = cases.filter(
    (caseResult) => caseResult.noMemory.reminded,
  ).length;

  return {
    completionNonRegressionPassCount,
    correctedFirstStepCount,
    correctedFirstStepRate: roundRate(
      correctedFirstStepCount,
      highRiskCases.length,
    ),
    falseBlockCount,
    falseBlockRate: roundRate(falseBlockCount, lowRiskCases.length),
    firstActionInterceptionCount,
    firstActionInterceptionRate: roundRate(
      firstActionInterceptionCount,
      highRiskCases.length,
    ),
    highRiskCaseCount: highRiskCases.length,
    lowRiskCaseCount: lowRiskCases.length,
    noMemoryReminderCount,
    phase32SoftGuardReminderCount,
    totalCases: cases.length,
  };
}

function buildAcceptance(
  summary: Phase34DeterministicSummary,
): Phase34DeterministicReport["acceptance"] {
  if (
    summary.firstActionInterceptionCount === summary.highRiskCaseCount &&
    summary.correctedFirstStepCount === summary.highRiskCaseCount &&
    summary.falseBlockCount === 0 &&
    summary.completionNonRegressionPassCount === summary.totalCases &&
    summary.phase32SoftGuardReminderCount >= summary.highRiskCaseCount &&
    summary.noMemoryReminderCount === 0
  ) {
    return {
      decision: "accepted",
      reason:
        "Policy-backed pre-action assessment intercepted every deterministic high-risk first step, rewrote or blocked it beyond the Phase 32 soft-guard baseline, and preserved the low-risk path.",
    };
  }

  return {
    decision: "blocked",
    reason:
      "Phase 34 deterministic evidence did not yet prove high-risk interception, corrected first-step rewrites, and low-risk non-regression across all canonical cases.",
  };
}

export async function runPhase34FallbackEval(
  options: Phase34EvalOptions = {},
  dependencies: Phase34EvalDependencies = {},
): Promise<Phase34DeterministicReport> {
  return withPhase34RulesOnlyEnv(async () => {
    const ensureDir = dependencies.ensureDir ?? mkdir;
    const now = dependencies.now ?? (() => new Date().toISOString());
    const writeTextFile = dependencies.writeTextFile ?? writeFile;
    const root = resolveRepoRootFromScriptUrl(import.meta.url);
    const generatedAt = now();
    const outputDir = options.outputDir ?? resolvePhase34FallbackOutputDir(root);
    const runId = options.runId ?? buildPhase34FallbackRunId(generatedAt);
    const runDirectory = join(outputDir, runId);

    const cases: Phase34DeterministicCaseResult[] = [];

    for (const caseSpec of PHASE34_CASES) {
      const policyBacked = await buildPolicyBackedCaseResult({
        caseSpec,
        timestamp: generatedAt,
      });
      const phase32SoftGuard = await buildSoftGuardCaseResult({
        caseSpec,
        mode: "phase32-soft-guard",
        timestamp: generatedAt,
      });
      const noMemory = await buildSoftGuardCaseResult({
        caseSpec,
        mode: "no-memory",
        timestamp: generatedAt,
      });

      cases.push(
        buildCaseResult({
          caseSpec,
          noMemory,
          phase32SoftGuard,
          policyBacked,
        }),
      );
    }

    const summary = buildSummary(cases);
    const report: Phase34DeterministicReport = {
      acceptance: buildAcceptance(summary),
      cases,
      generatedAt,
      generatedBy: GENERATED_BY,
      mode: "fallback",
      outputDir,
      phase: "phase-34",
      runDirectory,
      runId,
      summary,
    };

    await ensureDir(runDirectory, { recursive: true });
    await writeTextFile(
      join(runDirectory, "report.json"),
      JSON.stringify(report, null, 2),
    );

    return report;
  });
}

async function main() {
  const report = await runPhase34FallbackEval(
    parsePhase34EvalCliOptions(process.argv),
  );
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
