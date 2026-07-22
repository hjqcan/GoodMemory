import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  GoodMemory,
  GoodMemoryConfig,
  RecallResult,
} from "../src/api/contracts";
import { createMemorySource } from "../src/domain/provenance";
import { createFactMemory } from "../src/domain/records";
import type { MemoryScope } from "../src/domain/scope";
import { executeInstalledHostHook } from "../src/install/hostHookRuntime";
import { createLanguageService } from "../src/language";
import {
  createProgressiveRecallService,
  encodeGoodMemoryRecordRef,
} from "../src/progressive/recall";
import {
  createNoopGoodMemoryJobsFacade,
  createNoopGoodMemoryRuntimeFacade,
} from "../src/testing/fakes";
import { resolveCliFlagValue } from "./cli-options";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

export interface Phase42EvalOptions {
  outputDir?: string;
  runId?: string;
}

export interface Phase42EvalDependencies {
  ensureDir?: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  now?: () => string;
  writeTextFile?: (path: string, content: string) => Promise<void>;
}

export interface Phase42EvalCliDependencies {
  argv?: readonly string[];
  exit?: (code: number) => void;
  log?: (message: string) => void;
  runEval?: (options?: Phase42EvalOptions) => Promise<Phase42EvalReport>;
}

export interface Phase42EvalReport {
  acceptance: {
    decision: "accepted" | "blocked";
    reason: string;
  };
  cases: {
    crossScopeDetailDenied: boolean;
    detailRejectsBareId: boolean;
    fragmentFallbackWithoutMcp: boolean;
    noRawScopeLeak: boolean;
    progressiveTokenBudgetPass: boolean;
    recallVisibleOnly: boolean;
    recordRefProtocolPass: boolean;
    workingMemoryRequired: boolean;
  };
  generatedAt: string;
  generatedBy: "scripts/run-phase-42-eval.ts";
  mode: "fallback";
  outputDir: string;
  phase: "phase-42";
  runDirectory: string;
  runId: string;
  summary: {
    passCount: number;
    totalChecks: number;
  };
}

const GENERATED_BY = "scripts/run-phase-42-eval.ts";
const PHASE42_SCOPE: MemoryScope = {
  agentId: "codex",
  sessionId: "phase42-session",
  userId: "phase42-user-secret",
  workspaceId: "phase42-workspace-secret",
};

export function resolvePhase42FallbackOutputDir(root: string): string {
  return join(root, "reports/eval/fallback/phase-42");
}

export function buildPhase42FallbackRunId(nowIso: string): string {
  return `run-${nowIso.replace(/[-:]/gu, "").replace(/\..+$/u, "").replace("T", "")}`;
}

export function parsePhase42EvalCliOptions(
  argv: readonly string[],
): Phase42EvalOptions {
  return {
    outputDir: resolveCliFlagValue(argv, "--output-dir"),
    runId: resolveCliFlagValue(argv, "--run-id"),
  };
}

export async function runPhase42FallbackEval(
  options: Phase42EvalOptions = {},
  dependencies: Phase42EvalDependencies = {},
): Promise<Phase42EvalReport> {
  const root = resolveRepoRootFromScriptUrl(import.meta.url);
  const now = dependencies.now?.() ?? new Date().toISOString();
  const outputDir = options.outputDir ?? resolvePhase42FallbackOutputDir(root);
  const runId = options.runId ?? buildPhase42FallbackRunId(now);
  const runDirectory = join(outputDir, runId);
  const language = createLanguageService();
  const service = createProgressiveRecallService({
    language,
    memory: createPhase42Memory(),
    scopeDigestSecret: "phase-42-progressive-eval-secret",
  });
  const query = "progressive recall runbook scope budget continuity";

  const index = await service.searchRecallIndex({
    includeRuntime: true,
    limit: 1,
    query,
    retrievalProfile: "coding_agent",
    scope: PHASE42_SCOPE,
  });
  const recordRefProtocolPass =
    index.records.length === 1 &&
    index.records[0]!.recordRef.startsWith("gmrec:v1:");
  const noRawScopeLeak =
    !JSON.stringify(index).includes(PHASE42_SCOPE.userId!) &&
    !JSON.stringify(index).includes(PHASE42_SCOPE.workspaceId!);
  const context = language.resolveFromText({ text: query });
  const workingMemoryRequired = index.records.some(
    (record) => record.title === language.render({ key: "working_memory" }, context),
  );
  const rendered = service.renderProgressiveContext({
    index,
    maxTokens: 3,
    query,
    retrievalProfile: "coding_agent",
  });
  const progressiveTokenBudgetPass = rendered.estimatedTokens <= 3;

  let crossScopeDetailDenied = false;
  try {
    await service.getProgressiveRecords({
      recordRefs: [
        encodeGoodMemoryRecordRef({
          id: "fact-0",
          recordKind: "fact",
          scopeDigest: "scope_other",
        }),
      ],
      scope: PHASE42_SCOPE,
    });
  } catch {
    crossScopeDetailDenied = true;
  }

  let detailRejectsBareId = false;
  try {
    await service.getProgressiveRecords({
      recordRefs: ["fact-0"],
      scope: PHASE42_SCOPE,
    });
  } catch {
    detailRejectsBareId = true;
  }

  const exportedOnlyService = createProgressiveRecallService({
    language,
    memory: createPhase42Memory({ omitRecallFacts: true }),
    scopeDigestSecret: "phase-42-progressive-eval-secret",
  });
  const exportedOnlyIndex = await exportedOnlyService.searchRecallIndex({
    query: "durable fact",
    scope: PHASE42_SCOPE,
  });
  const recallVisibleOnly = !exportedOnlyIndex.records.some(
    (record) => record.recordKind === "fact",
  );
  const fragmentFallbackWithoutMcp = await runFragmentFallbackProbe();

  const cases = {
    crossScopeDetailDenied,
    detailRejectsBareId,
    fragmentFallbackWithoutMcp,
    noRawScopeLeak,
    progressiveTokenBudgetPass,
    recallVisibleOnly,
    recordRefProtocolPass,
    workingMemoryRequired,
  };
  const passCount = Object.values(cases).filter(Boolean).length;
  const totalChecks = Object.values(cases).length;
  const accepted = passCount === totalChecks;
  const report: Phase42EvalReport = {
    acceptance: {
      decision: accepted ? "accepted" : "blocked",
      reason: accepted
        ? "Progressive recall protocol passed recordRef, scope, redaction, fallback, token budget, recall visibility, and working-memory continuity checks."
        : "Progressive recall protocol failed one or more deterministic checks.",
    },
    cases,
    generatedAt: now,
    generatedBy: GENERATED_BY,
    mode: "fallback",
    outputDir,
    phase: "phase-42",
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

async function runFragmentFallbackProbe(): Promise<boolean> {
  const result = await executeInstalledHostHook(
    {
      command: "user-prompt-submit",
      host: "codex",
      homeRoot: join(tmpdir(), "goodmemory-phase42-no-mcp-home"),
      payload: {
        cwd: join(tmpdir(), "goodmemory-phase42-workspace"),
        prompt: "Check progressive fallback.",
        session_id: PHASE42_SCOPE.sessionId,
      },
    },
    {
      readFile: async (path) => {
        if (path.includes("goodmemory-phase42-no-mcp-home")) {
          return JSON.stringify({
            activationMode: "global",
            contextMode: "progressive",
            debug: false,
            host: "codex",
            maxTokens: 64,
            retrievalProfile: "coding_agent",
            storage: {
              provider: "memory",
              url: "memory://phase-42",
            },
            userId: PHASE42_SCOPE.userId,
            version: 1,
          });
        }
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
      createMemory: (() =>
        ({
          jobs: createNoopGoodMemoryJobsFacade(),
          runtime: createNoopGoodMemoryRuntimeFacade(),
          async buildContext() {
            return {
              content: "Developer memory notes:\nFallback fragment remains available.",
              estimatedTokens: 12,
              omittedSections: [],
              output: "developer_prompt_fragment",
            };
          },
          async recall() {
            return createPhase42Recall();
          },
          async remember() {
            throw new Error("not used");
          },
          async forget() {
            throw new Error("not used");
          },
          async exportMemory() {
            throw new Error("not used");
          },
          async deleteAllMemory() {
            throw new Error("not used");
          },
          async feedback() {
            throw new Error("not used");
          },
          async reviseMemory() {
            throw new Error("not used");
          },
          async runMaintenance() {
            throw new Error("not used");
          },
        }) satisfies GoodMemory) as (config: GoodMemoryConfig) => GoodMemory,
    },
  );
  return result.applied && result.context?.includes("Developer memory notes") === true;
}

function createPhase42Memory(input: { omitRecallFacts?: boolean } = {}) {
  return {
    async recall(): Promise<RecallResult> {
      return createPhase42Recall(input);
    },
  };
}

function createPhase42Recall(input: { omitRecallFacts?: boolean } = {}): RecallResult {
  const source = createMemorySource({
    extractedAt: "2026-04-26T00:00:00.000Z",
    method: "explicit",
    sessionId: PHASE42_SCOPE.sessionId,
  });
  const facts = input.omitRecallFacts
    ? []
    : Array.from({ length: 8 }, (_, index) =>
        createFactMemory({
          agentId: PHASE42_SCOPE.agentId,
          category: "project",
          content: `progressive recall runbook durable fact ${index}`,
          createdAt: `2026-04-26T00:0${index}:00.000Z`,
          id: `fact-${index}`,
          sessionId: PHASE42_SCOPE.sessionId,
          source,
          updatedAt: `2026-04-26T00:0${index}:00.000Z`,
          userId: PHASE42_SCOPE.userId!,
          workspaceId: PHASE42_SCOPE.workspaceId,
        }),
      );

  return {
    archives: [],
    episodes: [],
    evidence: [],
    facts,
    feedback: [],
    journal: null,
    metadata: {
      candidateTraces: [],
      hits: [],
      latencyMs: 1,
      policyApplied: [],
      routingDecision: {
        actionDriving: false,
        continuation: false,
        intent: "general_assistance",
        referenceSeeking: false,
        requestedSlots: [],
        retrievalProfile: "coding_agent",
        sourcePriorities: [],
        strategy: "rules-only",
        strategyExplanation: {
          hardFloor: "lexical_runtime_procedural_priors",
          llmRefinement: false,
          requestedStrategy: "rules-only",
          resolvedStrategy: "rules-only",
          semanticTieBreaking: false,
          summary: "phase 42 eval",
        },
        supportSlots: [],
      },
      tokenCount: 1,
      verificationHints: [],
    },
    packet: {
      debug: {
        estimatedTokens: 0,
        omittedSections: [],
      },
      renderingProfile: "coding_agent",
    },
    preferences: [],
    profile: null,
    references: [],
    workingMemory: {
      constraints: ["MCP is an adapter, not the owner."],
      currentGoal: "Keep progressive recall reusable across hosts.",
      openLoops: ["Preserve detail drill-down", "Keep redaction safe"],
      sessionId: PHASE42_SCOPE.sessionId!,
      temporaryDecisions: ["Expose scopeDigest, not raw scope ids."],
      updatedAt: "2026-04-26T00:10:00.000Z",
      userId: PHASE42_SCOPE.userId!,
    },
  };
}

export async function runPhase42EvalCli(
  dependencies: Phase42EvalCliDependencies = {},
): Promise<void> {
  const argv = dependencies.argv ?? process.argv;
  const options = parsePhase42EvalCliOptions(argv);
  try {
    const report = await (dependencies.runEval ?? runPhase42FallbackEval)(options);
    dependencies.log?.(
      `Phase 42 deterministic eval ${report.acceptance.decision}: ${report.runDirectory}`,
    );
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
  await runPhase42EvalCli({
    log: console.log,
  });
}
