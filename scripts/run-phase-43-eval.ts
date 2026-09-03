import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  BuildContextResult,
  GoodMemory,
  GoodMemoryRuntimeStateResult,
  RecallResult,
  RememberInput,
} from "../src/api/contracts";
import type { MemoryScope } from "../src/domain/scope";
import type {
  HostActionAssessmentResult,
  HostActionIntent,
} from "../src/host";
import type {
  ProgressiveRecallIndex,
  ProgressiveRecallService,
} from "../src/progressive/recall";
import { createGoodMemoryRuntimeKit } from "../src/runtime-kit";
import {
  createNoopGoodMemoryJobsFacade,
} from "../src/testing/fakes";
import { resolveCliFlagValue } from "./cli-options";
import { resolveRepoRootFromScriptUrl } from "./script-paths";
import { buildPageArtifacts } from "../src/governance/pageArtifacts";

export interface Phase43EvalOptions {
  outputDir?: string;
  runId?: string;
}

export interface Phase43EvalDependencies {
  ensureDir?: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  now?: () => string;
  readTextFile?: (path: string) => Promise<string>;
  writeTextFile?: (path: string, content: string) => Promise<void>;
}

export interface Phase43EvalCliDependencies {
  argv?: readonly string[];
  exit?: (code: number) => void;
  log?: (message: string) => void;
  runEval?: (options?: Phase43EvalOptions) => Promise<Phase43EvalReport>;
}

export interface Phase43EvalReport {
  acceptance: {
    decision: "accepted" | "blocked";
    reason: string;
  };
  cases: {
    aiSdkRuntimeKitReuseBoundary: boolean;
    eventScopeDigestOnly: boolean;
    fragmentLifecyclePass: boolean;
    observeNoDurableWrite: boolean;
    preActionExecutionPlanPass: boolean;
    progressiveLifecyclePass: boolean;
    selectiveWritebackGovernancePass: boolean;
    sessionLifecycleNoTranscriptArchive: boolean;
  };
  generatedAt: string;
  generatedBy: "scripts/run-phase-43-eval.ts";
  mode: "fallback";
  outputDir: string;
  phase: "phase-43";
  runDirectory: string;
  runId: string;
  summary: {
    passCount: number;
    totalChecks: number;
  };
}

const GENERATED_BY = "scripts/run-phase-43-eval.ts";
const PHASE43_SCOPE: MemoryScope = {
  agentId: "codex",
  sessionId: "phase43-session-secret",
  userId: "phase43-user-secret",
  workspaceId: "phase43-workspace-secret",
};

export function resolvePhase43FallbackOutputDir(root: string): string {
  return join(root, "reports/eval/fallback/phase-43");
}

export function buildPhase43FallbackRunId(nowIso: string): string {
  return `run-${nowIso.replace(/[-:]/gu, "").replace(/\..+$/u, "").replace("T", "")}`;
}

export function parsePhase43EvalCliOptions(
  argv: readonly string[],
): Phase43EvalOptions {
  return {
    outputDir: resolveCliFlagValue(argv, "--output-dir"),
    runId: resolveCliFlagValue(argv, "--run-id"),
  };
}

export async function runPhase43FallbackEval(
  options: Phase43EvalOptions = {},
  dependencies: Phase43EvalDependencies = {},
): Promise<Phase43EvalReport> {
  const root = resolveRepoRootFromScriptUrl(import.meta.url);
  const now = dependencies.now?.() ?? new Date().toISOString();
  const outputDir = options.outputDir ?? resolvePhase43FallbackOutputDir(root);
  const runId = options.runId ?? buildPhase43FallbackRunId(now);
  const runDirectory = join(outputDir, runId);
  const rememberCalls: RememberInput[] = [];
  const memory = createPhase43Memory({ rememberCalls });
  const progressiveRecall = createPhase43ProgressiveRecallService();
  const runtimeKit = createGoodMemoryRuntimeKit({
    memory,
    defaultContextMode: "fragment",
    progressiveRecall,
    scopeDigestSecret: "phase-43-runtime-kit-secret",
    hostAdapter: {
      async assessAction(intent) {
        return createPhase43Assessment(intent);
      },
    },
  });

  const fragment = await runtimeKit.beforeModelCall({
    scope: PHASE43_SCOPE,
    query: "runtime kit fragment",
    maxMemoryTokens: 64,
  });
  const fragmentLifecyclePass =
    fragment.context.mode === "fragment" &&
    fragment.context.content.includes("Runtime kit fragment context") &&
    fragment.events[0]?.status === "applied";

  const progressive = await runtimeKit.beforeModelCall({
    scope: PHASE43_SCOPE,
    query: "runtime kit progressive",
    contextMode: "progressive",
    maxMemoryTokens: 64,
  });
  const progressiveLifecyclePass =
    progressive.context.mode === "progressive" &&
    progressive.context.recordRefs?.[0] ===
      "gmrec:v1:scope_phase43:fact:fact-1";

  const observed = await runtimeKit.afterModelCall({
    scope: PHASE43_SCOPE,
    messages: [{ role: "user", content: "My email is phase43@example.com." }],
    assistantText: "Use token sk-phase43secret for this run.",
    writeback: { mode: "observe" },
  });
  const observeNoDurableWrite =
    rememberCalls.length === 0 &&
    observed.candidates.length === 1 &&
    observed.trace.rawTranscriptPersisted === false;
  const eventJson = JSON.stringify(observed.events);
  const eventScopeDigestOnly =
    observed.events[0]?.scopeDigest.userIdHash.startsWith("hmac-sha256:") === true &&
    !eventJson.includes(PHASE43_SCOPE.userId!) &&
    !eventJson.includes(PHASE43_SCOPE.workspaceId!) &&
    !eventJson.includes(PHASE43_SCOPE.sessionId!);

  const selective = await runtimeKit.afterModelCall({
    scope: PHASE43_SCOPE,
    messages: [{ role: "user", content: "Remember the runtime-kit gate." }],
    assistantText: "The runtime-kit gate uses bounded lifecycle events.",
    writeback: {
      mode: "selective",
      annotation: "durable_candidate",
      policy: "allow",
    },
  });
  const selectiveWritebackGovernancePass =
    rememberCalls.length === 1 &&
    selective.rememberResult?.accepted === 1 &&
    rememberCalls[0]?.messages[0]?.role === "user" &&
    rememberCalls[0]?.messages[1]?.role === "assistant";

  const preAction = await runtimeKit.preAction({
    intent: createPhase43HostActionIntent(),
  });
  const preActionExecutionPlanPass =
    preAction.executionPlan.decision === "review_required" &&
    preAction.executionPlan.rewritten &&
    !preAction.executionPlan.executeOriginalActionNow;

  const session = await runtimeKit.sessionEnd({
    scope: PHASE43_SCOPE,
    archive: "off",
  });
  const sessionLifecycleNoTranscriptArchive =
    session.events[0]?.status === "succeeded" &&
    JSON.stringify(session.events).includes("scopeDigest") &&
    !JSON.stringify(session.events).includes(PHASE43_SCOPE.userId!);

  const aiSdkSource = await readText(
    join(root, "src/ai-sdk/public.ts"),
    dependencies,
  );
  const aiSdkRuntimeKitReuseBoundary =
    aiSdkSource.includes("createGoodMemoryRuntimeKit") &&
    !aiSdkSource.includes("config.memory.recall") &&
    !aiSdkSource.includes("config.memory.buildContext") &&
    !aiSdkSource.includes("config.memory.remember") &&
    !aiSdkSource.includes("input.memory.recall") &&
    !aiSdkSource.includes("input.memory.buildContext") &&
    !aiSdkSource.includes("input.memory.remember");

  const cases = {
    aiSdkRuntimeKitReuseBoundary,
    eventScopeDigestOnly,
    fragmentLifecyclePass,
    observeNoDurableWrite,
    preActionExecutionPlanPass,
    progressiveLifecyclePass,
    selectiveWritebackGovernancePass,
    sessionLifecycleNoTranscriptArchive,
  };
  const passCount = Object.values(cases).filter(Boolean).length;
  const totalChecks = Object.values(cases).length;
  const accepted = passCount === totalChecks;
  const report: Phase43EvalReport = {
    acceptance: {
      decision: accepted ? "accepted" : "blocked",
      reason: accepted
        ? "Runtime Kit passed lifecycle, progressive reuse, preAction plan, writeback governance, AI SDK reuse, and scopeDigest event checks."
        : "Runtime Kit failed one or more deterministic lifecycle checks.",
    },
    cases,
    generatedAt: now,
    generatedBy: GENERATED_BY,
    mode: "fallback",
    outputDir,
    phase: "phase-43",
    runDirectory,
    runId,
    summary: {
      passCount,
      totalChecks,
    },
  };

  await (dependencies.ensureDir ?? mkdir)(runDirectory, { recursive: true });
  await (dependencies.writeTextFile ?? writeFile)(
    join(runDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

function createPhase43RuntimeState(): GoodMemoryRuntimeStateResult {
  return {
    state: {
      buffer: {
        sessionId: PHASE43_SCOPE.sessionId!,
        userId: PHASE43_SCOPE.userId,
        messages: [],
        summary: null,
        summaryUpToIndex: -1,
        createdAt: "2026-04-26T00:00:00.000Z",
        lastActiveAt: "2026-04-26T00:00:00.000Z",
      },
      workingMemory: {
        sessionId: PHASE43_SCOPE.sessionId!,
        userId: PHASE43_SCOPE.userId,
        openLoops: ["close phase 43 runtime-kit gate"],
        updatedAt: "2026-04-26T00:00:00.000Z",
      },
      journal: {
        sessionId: PHASE43_SCOPE.sessionId!,
        userId: PHASE43_SCOPE.userId,
        worklog: ["runtime-kit deterministic eval"],
        updatedAt: "2026-04-26T00:00:00.000Z",
      },
    },
    traceId: "phase43-runtime-trace",
  };
}

function createPhase43Recall(): RecallResult {
  return {
    profile: null,
    preferences: [],
    references: [],
    notes: [],
    facts: [],
    feedback: [],
    archives: [],
    evidence: [],
    episodes: [],
    workingMemory: null,
    journal: null,
    packet: {},
    metadata: {
      routingDecision: {
        retrievalProfile: "coding_agent",
        intent: "task_continuation",
        strategy: "rules-only",
        strategyExplanation: {
          requestedStrategy: "rules-only",
          resolvedStrategy: "rules-only",
          summary: "phase 43 deterministic eval",
          hardFloor: "lexical_runtime_procedural_priors",
          semanticTieBreaking: false,
          llmRefinement: false,
        },
        sourcePriorities: [],
        requestedSlots: [],
        supportSlots: [],
        actionDriving: true,
        referenceSeeking: false,
        continuation: true,
      },
      tokenCount: 0,
      latencyMs: 0,
      hits: [],
      candidateTraces: [],
      verificationHints: [],
      policyApplied: [],
    },
  };
}

function createPhase43Memory(input: {
  rememberCalls: RememberInput[];
}): GoodMemory {
  const state = createPhase43RuntimeState();
  return {
    jobs: createNoopGoodMemoryJobsFacade(),
    runtime: {
      async startSession() {
        return state;
      },
      async getState() {
        return state;
      },
      async appendMessage() {
        return { buffer: state.state.buffer };
      },
      async setSessionSummary() {
        return { buffer: state.state.buffer };
      },
      async updateWorkingMemory() {
        return { workingMemory: state.state.workingMemory };
      },
      async updateSessionJournal() {
        return { journal: state.state.journal };
      },
      async getRecallSnapshot() {
        return {
          snapshot: {
            buffer: state.state.buffer,
            workingMemory: state.state.workingMemory,
            journal: state.state.journal,
          },
        };
      },
      async endSession() {
        return state;
      },
    },
    async recall() {
      return createPhase43Recall();
    },
    async buildContext(): Promise<BuildContextResult> {
      return {
        output: "system_prompt_fragment",
        content: "Runtime kit fragment context.",
        estimatedTokens: 8,
        omittedSections: [],
      };
    },
    async remember(payload) {
      input.rememberCalls.push(payload);
      return {
        accepted: 1,
        rejected: 0,
        events: [],
      };
    },
    async reviseMemory() {
      return {
        accepted: false,
        outcome: "unsupported",
        policyApplied: [],
      };
    },
    async importMemory() {
      throw new Error("importMemory is not implemented by this fake.");
    },
    async forget() {
      return { forgotten: false };
    },
    async exportMemory() {
      return {
        pages: buildPageArtifacts({ notes: [] }),
        artifacts: { rootPath: "", files: [] },
        scope: PHASE43_SCOPE,
        exportedAt: "2026-04-26T00:00:00.000Z",
        durable: {
          profile: null,
          preferences: [],
          references: [],
          facts: [],
          feedback: [],
          episodes: [],
          archives: [],
          evidence: [],
          experiences: [],
          proposals: [],
          promotions: [],
        },
      };
    },
    async deleteAllMemory() {
      throw new Error("not used");
    },
    async feedback() {
      throw new Error("not used");
    },
    async runMaintenance() {
      throw new Error("not used");
    },
  };
}

function createPhase43ProgressiveRecallService(): ProgressiveRecallService {
  const index: ProgressiveRecallIndex = {
    generatedAt: "2026-04-26T00:00:00.000Z",
    query: "runtime kit progressive",
    scopeDigest: "scope_phase43",
    totalRecordCount: 1,
    records: [
      {
        recordRef: "gmrec:v1:scope_phase43:fact:fact-1",
        recordKind: "fact",
        title: "Runtime Kit fact",
        summary: "Runtime Kit reuses the progressive recall service.",
        score: 1,
        estimatedDetailTokens: 12,
        estimatedIndexTokens: 8,
        source: "durable",
      },
    ],
  };

  return {
    async searchRecallIndex() {
      return index;
    },
    async buildRecallTimeline() {
      return {
        buckets: [{ label: "undated", records: index.records }],
        scopeDigest: index.scopeDigest,
        totalRecordCount: index.totalRecordCount,
      };
    },
    async getProgressiveRecords() {
      return {
        records: [],
        scopeDigest: index.scopeDigest,
      };
    },
    renderProgressiveContext() {
      return {
        content:
          "Progressive GoodMemory Recall\nref: gmrec:v1:scope_phase43:fact:fact-1",
        estimatedTokens: 16,
        omittedRecordCount: 0,
      };
    },
  };
}

function createPhase43HostActionIntent(): HostActionIntent {
  return {
    actionId: "phase43-action",
    runId: "phase43-run",
    turnId: "phase43-turn",
    sequence: 1,
    occurredAt: "2026-04-26T00:00:00.000Z",
    hostKind: "codex",
    scope: PHASE43_SCOPE,
    action: {
      kind: "command",
      command: "deploy production",
    },
  };
}

function createPhase43Assessment(
  intent: HostActionIntent,
): HostActionAssessmentResult {
  return {
    actionId: intent.actionId,
    auditRecorded: true,
    decision: "review_required",
    guidance: ["Run the runtime-kit verification command first."],
    matchedEvidenceIds: [],
    matchedMemoryIds: [],
    policyApplied: ["phase-43-runtime-kit-eval"],
    reason: "Production deploys require an explicit verification first step.",
    recommendedFirstStep: {
      kind: "command",
      command: "bun test tests/unit/runtime-kit.test.ts",
    },
    requiredPreconditions: ["runtime-kit tests pass"],
  };
}

async function readText(
  path: string,
  dependencies: Phase43EvalDependencies,
): Promise<string> {
  if (dependencies.readTextFile) {
    return await dependencies.readTextFile(path);
  }
  return await readFile(path, "utf8");
}

export async function runPhase43EvalCli(
  dependencies: Phase43EvalCliDependencies = {},
): Promise<void> {
  const argv = dependencies.argv ?? process.argv;
  const options = parsePhase43EvalCliOptions(argv);
  try {
    const report = await (dependencies.runEval ?? runPhase43FallbackEval)(options);
    dependencies.log?.(
      `Phase 43 deterministic eval ${report.acceptance.decision}: ${report.runDirectory}`,
    );
    if (report.acceptance.decision !== "accepted") {
      dependencies.exit?.(1);
      if (!dependencies.exit) {
        process.exitCode = 1;
      }
    }
  } catch (error) {
    dependencies.log?.(
      error instanceof Error ? error.message : String(error),
    );
    dependencies.exit?.(1);
    if (!dependencies.exit) {
      process.exitCode = 1;
    }
  }
}

if (import.meta.main) {
  await runPhase43EvalCli({
    log: console.log,
  });
}
