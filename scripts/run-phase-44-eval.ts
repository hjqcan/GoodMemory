import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ExportMemoryResult,
  RecallInput,
  RecallResult,
} from "../src/api/contracts";
import type { MemoryScope } from "../src/domain/scope";
import {
  createRuntimeViewerApp,
  normalizeRuntimeViewerBindHost,
} from "../src/runtime-viewer/public";
import { resolveCliFlagValue } from "./cli-options";
import { resolveRepoRootFromScriptUrl } from "./script-paths";
import { buildPageArtifacts } from "../src/governance/pageArtifacts";

export interface Phase44EvalOptions {
  outputDir?: string;
  runId?: string;
}

export interface Phase44EvalDependencies {
  ensureDir?: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  now?: () => string;
  readTextFile?: (path: string) => Promise<string>;
  writeTextFile?: (path: string, content: string) => Promise<void>;
}

export interface Phase44EvalCliDependencies {
  argv?: readonly string[];
  exit?: (code: number) => void;
  log?: (message: string) => void;
  runEval?: (options?: Phase44EvalOptions) => Promise<Phase44EvalReport>;
}

export interface Phase44EvalReport {
  acceptance: {
    decision: "accepted" | "blocked";
    reason: string;
  };
  cases: {
    auditTraceSessionViewsPass: boolean;
    handoffReadOnlyPass: boolean;
    localBindPass: boolean;
    noCorsPass: boolean;
    noMutationRoutesPass: boolean;
    noRawTranscriptPass: boolean;
    noRootApiWideningPass: boolean;
    packageLicenseHygienePass: boolean;
    progressiveDrilldownPass: boolean;
    staticShellPass: boolean;
    tokenSecurityPass: boolean;
  };
  generatedAt: string;
  generatedBy: "scripts/run-phase-44-eval.ts";
  mode: "fallback";
  outputDir: string;
  phase: "phase-44";
  runDirectory: string;
  runId: string;
  summary: {
    passCount: number;
    totalChecks: number;
  };
}

const GENERATED_BY = "scripts/run-phase-44-eval.ts";
const PHASE44_TOKEN = "phase44-local-viewer-token";
const PHASE44_SCOPE: MemoryScope = {
  agentId: "codex",
  sessionId: "phase44-session-secret",
  tenantId: "phase44-tenant-secret",
  userId: "phase44-user-secret",
  workspaceId: "phase44-workspace-secret",
};

interface AdminEnvelope<T> {
  data: T;
}

export function resolvePhase44FallbackOutputDir(root: string): string {
  return join(root, "reports/eval/fallback/phase-44");
}

export function buildPhase44FallbackRunId(nowIso: string): string {
  return `run-${nowIso.replace(/[-:]/gu, "").replace(/\..+$/u, "").replace("T", "")}`;
}

export function parsePhase44EvalCliOptions(
  argv: readonly string[],
): Phase44EvalOptions {
  return {
    outputDir: resolveCliFlagValue(argv, "--output-dir"),
    runId: resolveCliFlagValue(argv, "--run-id"),
  };
}

export async function runPhase44FallbackEval(
  options: Phase44EvalOptions = {},
  dependencies: Phase44EvalDependencies = {},
): Promise<Phase44EvalReport> {
  const root = resolveRepoRootFromScriptUrl(import.meta.url);
  const now = dependencies.now?.() ?? new Date().toISOString();
  const outputDir = options.outputDir ?? resolvePhase44FallbackOutputDir(root);
  const runId = options.runId ?? buildPhase44FallbackRunId(now);
  const runDirectory = join(outputDir, runId);
  await (dependencies.ensureDir ?? mkdir)(runDirectory, { recursive: true });

  const memory = createPhase44Memory();
  const app = createRuntimeViewerApp({
    memory,
    now: () => new Date(now),
    scope: PHASE44_SCOPE,
    token: PHASE44_TOKEN,
  });

  const unauthorized = await app.fetch(
    new Request("http://127.0.0.1/admin/v1/scopes"),
  );
  const scopesResponse = await app.fetch(authorized("/admin/v1/scopes"));
  const scopes = await scopesResponse.json() as AdminEnvelope<{
    items: Array<{ scopeKey: string }>;
  }>;
  const scopeKey = scopes.data.items[0]?.scopeKey;
  const descriptorResponse = await app.fetch(
    authorized("/admin/v1/descriptor"),
  );
  const descriptor = await descriptorResponse.json() as AdminEnvelope<{
    mutationRoutes: boolean;
    readOnly: boolean;
    tokenRequired: boolean;
  }>;
  const memoriesResponse = scopeKey
    ? await app.fetch(
        authorized(
          `/admin/v1/scopes/${encodeURIComponent(scopeKey)}/memories`,
        ),
      )
    : null;
  const memories = memoriesResponse
    ? await memoriesResponse.json() as AdminEnvelope<{
        items: Array<{ id: string; summary: string }>;
      }>
    : { data: { items: [] } };
  const memoryItem = memories.data.items.find(({ id }) => id === "phase44-fact-1");
  const traceResponse = scopeKey
    ? await app.fetch(
        authorized("/admin/v1/recall-traces", {
          body: JSON.stringify({ query: "viewer", scopeKey }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      )
    : null;
  const traceJson = traceResponse ? await traceResponse.text() : "";
  const mutation = scopeKey
    ? await app.fetch(
        authorized(
          `/admin/v1/scopes/${encodeURIComponent(scopeKey)}/memories/phase44-fact-1`,
          { method: "DELETE" },
        ),
      )
    : null;
  const revision = scopeKey
    ? await app.fetch(
        authorized(
          `/admin/v1/scopes/${encodeURIComponent(scopeKey)}/memories/phase44-fact-1/revisions`,
          { method: "POST" },
        ),
      )
    : null;
  const crossScope = await app.fetch(
    authorized("/admin/v1/scopes/scope_other/memories"),
  );
  const scopesJson = JSON.stringify(scopes);
  const memoriesJson = JSON.stringify(memories);
  const rootSource = await readText(join(root, "src/index.ts"), dependencies);
  const packageJson = JSON.parse(
    await readText(join(root, "package.json"), dependencies),
  ) as {
    exports?: Record<string, unknown>;
    files?: string[];
  };

  const tokenSecurityPass = unauthorized.status === 401 && scopesResponse.status === 200;
  const noCorsPass =
    !scopesResponse.headers.has("access-control-allow-origin") &&
    !descriptorResponse.headers.has("access-control-allow-origin");
  const noMutationRoutesPass = mutation?.status === 405;
  // Legacy Phase 44 report keys remain stable while the deprecated viewer now
  // proves its boundary through the scope-bound, read-only Inspector adapter.
  const staticShellPass =
    descriptorResponse.status === 200 &&
    descriptor.data.readOnly === true &&
    descriptor.data.mutationRoutes === false &&
    descriptor.data.tokenRequired === true;
  const progressiveDrilldownPass =
    memoriesResponse?.status === 200 &&
    memoryItem?.summary.includes("read-only") === true &&
    crossScope.status === 404;
  const auditTraceSessionViewsPass =
    traceResponse?.status === 200 &&
    traceJson.includes("candidateTraces") &&
    traceJson.includes("phase44-fact-1") &&
    traceJson.includes("phase44-viewer-read-only");
  const handoffReadOnlyPass =
    descriptor.data.readOnly === true &&
    mutation?.status === 405 &&
    revision?.status === 405;
  const noRawTranscriptPass =
    !scopesJson.includes("raw phase44 transcript") &&
    !memoriesJson.includes("raw phase44 transcript") &&
    !memoriesJson.includes("phase44@example.com") &&
    !memoriesJson.includes("sk-phase44secret") &&
    !traceJson.includes("raw phase44 transcript") &&
    !traceJson.includes("phase44@example.com") &&
    !traceJson.includes("sk-phase44secret");
  const localBindPass =
    normalizeRuntimeViewerBindHost(undefined) === "127.0.0.1" &&
    throwsLocalBindError("0.0.0.0");
  const noRootApiWideningPass =
    !rootSource.includes("runtime-viewer") &&
    !rootSource.includes("createRuntimeViewerApp") &&
    !rootSource.includes("serveRuntimeViewer");
  const packageLicenseHygienePass =
    packageJson.exports?.["./runtime-viewer"] === undefined &&
    !(packageJson.files ?? []).includes("third-party") &&
    !(packageJson.files ?? []).includes("third-party/claude-mem-main");

  const cases = {
    auditTraceSessionViewsPass,
    handoffReadOnlyPass,
    localBindPass,
    noCorsPass,
    noMutationRoutesPass,
    noRawTranscriptPass,
    noRootApiWideningPass,
    packageLicenseHygienePass,
    progressiveDrilldownPass,
    staticShellPass,
    tokenSecurityPass,
  };
  const passCount = Object.values(cases).filter(Boolean).length;
  const totalChecks = Object.values(cases).length;
  const accepted = passCount === totalChecks;
  const report: Phase44EvalReport = {
    acceptance: {
      decision: accepted ? "accepted" : "blocked",
      reason: accepted
        ? "The deprecated runtime viewer passed its token, loopback, no-CORS, read-only Admin API, scoped memory, recall trace, redaction, and package-boundary compatibility checks."
        : "The deprecated runtime viewer adapter failed one or more deterministic checks.",
    },
    cases,
    generatedAt: now,
    generatedBy: GENERATED_BY,
    mode: "fallback",
    outputDir,
    phase: "phase-44",
    runDirectory,
    runId,
    summary: {
      passCount,
      totalChecks,
    },
  };

  await (dependencies.writeTextFile ?? writeFile)(
    join(runDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

function createPhase44Memory() {
  const exported = createPhase44ExportedMemory();
  return {
    async exportMemory(input: { includeRuntime?: boolean; scope: MemoryScope }) {
      return {
        ...exported,
        runtime: input.includeRuntime === true ? exported.runtime : undefined,
        scope: input.scope,
      };
    },
    async recall(input: RecallInput): Promise<RecallResult> {
      return {
        archives: exported.durable.archives,
        episodes: exported.durable.episodes,
        evidence: exported.durable.evidence,
        facts: exported.durable.facts,
        feedback: exported.durable.feedback,
        journal: exported.runtime?.journal ?? null,
        metadata: {
          candidateTraces: [
            {
              explicitnessScore: 1,
              fallback: "none",
              freshnessScore: 1,
              intentScore: 1,
              lexicalScore: 1,
              memoryId: "phase44-fact-1",
              memoryType: "fact",
              returned: true,
              slot: "generic",
            },
          ],
          hits: [{ id: "phase44-fact-1", type: "fact" }],
          latencyMs: 1,
          policyApplied: ["phase44-viewer-read-only"],
          routingDecision: {
            actionDriving: false,
            continuation: false,
            intent: "general_assistance",
            referenceSeeking: false,
            requestedSlots: [],
            retrievalProfile: input.retrievalProfile ?? "coding_agent",
            sourcePriorities: [],
            strategy: "rules-only",
            strategyExplanation: {
              hardFloor: "lexical_runtime_procedural_priors",
              llmRefinement: false,
              requestedStrategy: "rules-only",
              resolvedStrategy: "rules-only",
              semanticTieBreaking: false,
              summary: "phase44 eval",
            },
            supportSlots: [],
          },
          tokenCount: 8,
          traceId: "phase44-trace-1",
          verificationHints: [],
        },
        packet: {},
        preferences: exported.durable.preferences,
        profile: exported.durable.profile,
        references: exported.durable.references,
        notes: [],
        workingMemory: exported.runtime?.workingMemory ?? null,
      };
    },
  };
}

function createPhase44ExportedMemory(): ExportMemoryResult {
  return {
    pages: buildPageArtifacts({ notes: [] }),
    artifacts: { files: [], rootPath: "." },
    durable: {
      archives: [
        {
          archivedAt: "2026-04-26T15:25:00.000Z",
          createdAt: "2026-04-26T15:20:00.000Z",
          id: "phase44-archive-1",
          keyDecisions: ["Viewer stays local and read-only."],
          normalizedTranscript: "raw phase44 transcript must stay hidden",
          referencedArtifacts: [],
          scopeLineage: [],
          sessionId: PHASE44_SCOPE.sessionId!,
          sourceSessionIds: [PHASE44_SCOPE.sessionId!],
          summary: "Phase 44 viewer closure.",
          unresolvedItems: [],
          userId: PHASE44_SCOPE.userId,
          workspaceId: PHASE44_SCOPE.workspaceId,
        },
      ],
      episodes: [],
      evidence: [],
      experiences: [],
      facts: [
        {
          category: "project",
          confidence: 1,
          content: "Phase 44 viewer is read-only.",
          createdAt: "2026-04-26T15:15:00.000Z",
          id: "phase44-fact-1",
          importance: 1,
          isActive: true,
          lifecycle: "active",
          source: {
            extractedAt: "2026-04-26T15:15:00.000Z",
            method: "explicit",
          },
          updatedAt: "2026-04-26T15:15:00.000Z",
          userId: PHASE44_SCOPE.userId,
          workspaceId: PHASE44_SCOPE.workspaceId,
        },
      ],
      feedback: [],
      preferences: [],
      profile: null,
      promotions: [],
      proposals: [],
      references: [],
    },
    exportedAt: "2026-04-26T15:30:00.000Z",
    runtime: {
      journal: {
        currentState: "Inspect phase44-session-secret safely.",
        errorsAndCorrections: [],
        filesAndFunctions: [],
        keyResults: [],
        learnings: ["Viewer has no mutation routes."],
        sessionId: PHASE44_SCOPE.sessionId!,
        systemDocumentation: [],
        title: "Phase 44 local viewer",
        updatedAt: "2026-04-26T15:30:00.000Z",
        userId: PHASE44_SCOPE.userId,
        workflow: [],
        worklog: ["Rendered local shell."],
      },
      spills: [],
      workingMemory: null,
    },
    scope: PHASE44_SCOPE,
  };
}

function authorized(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${PHASE44_TOKEN}`);
  return new Request(`http://127.0.0.1${path}`, {
    ...init,
    headers,
  });
}

function throwsLocalBindError(value: string): boolean {
  try {
    normalizeRuntimeViewerBindHost(value);
    return false;
  } catch {
    return true;
  }
}

async function readText(
  path: string,
  dependencies: Phase44EvalDependencies,
): Promise<string> {
  if (dependencies.readTextFile) {
    return await dependencies.readTextFile(path);
  }
  return await readFile(path, "utf8");
}

export async function runPhase44EvalCli(
  dependencies: Phase44EvalCliDependencies = {},
): Promise<void> {
  const argv = dependencies.argv ?? process.argv;
  const options = parsePhase44EvalCliOptions(argv);
  try {
    const report = await (dependencies.runEval ?? runPhase44FallbackEval)(options);
    dependencies.log?.(
      `Phase 44 deterministic eval ${report.acceptance.decision}: ${report.runDirectory}`,
    );
    if (report.acceptance.decision !== "accepted") {
      dependencies.exit?.(1);
      if (!dependencies.exit) {
        process.exitCode = 1;
      }
    }
  } catch (error) {
    dependencies.log?.(error instanceof Error ? error.message : String(error));
    dependencies.exit?.(1);
    if (!dependencies.exit) {
      process.exitCode = 1;
    }
  }
}

if (import.meta.main) {
  await runPhase44EvalCli({
    log: console.log,
  });
}
