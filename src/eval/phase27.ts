import { existsSync, mkdtempSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGoodMemory } from "../api/createGoodMemory";
import type { ExportMemoryResult, GoodMemory, GoodMemoryConfig } from "../api/contracts";
import {
  DEFAULT_SQLITE_STORAGE_PATH,
  resolveGoodMemoryRuntimeResolution,
} from "../api/runtimeResolution";
import {
  createFeedbackMemory,
  createReferenceMemory,
} from "../domain/records";
import { createMemorySource } from "../domain/provenance";
import { findAffirmedSignals, findMissingAffirmedSignals } from "./signalMatching";
import type { JudgedEvalCase } from "./contracts";
import type { PersonaSpec, ScenarioFixture } from "./dataset";
import { createHostAdapter } from "../host/public";
import {
  createRuntimeArchiveStore,
  createRuntimeContextService,
} from "../runtime/public";
import {
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
} from "../storage/sqlite";
import type { EvalSuiteResult } from "./suite";
import { buildPageArtifacts } from "../governance/pageArtifacts";

export const PHASE_27_IDENTITY_BACKGROUND_SCENARIO_IDS = [
  "scenario-medium-13-role-slot",
  "scenario-long-01",
  "scenario-long-02",
] as const;

export const PHASE_27_CONTINUATION_OPEN_LOOP_SCENARIO_IDS = [
  "scenario-medium-01",
  "scenario-medium-13",
  "scenario-medium-17",
  "scenario-complex-01",
  "scenario-complex-05",
  "scenario-long-03",
] as const;

export const PHASE_27_REPEATED_CORRECTION_SCENARIO_IDS = [
  "scenario-medium-11-blocker-slot-zh",
  "scenario-medium-11-reference-slot-zh",
  "scenario-medium-13-reference-slot",
  "scenario-medium-13-reference-next-step",
] as const;

export const PHASE_27_LIVE_CONTINUATION_OPEN_LOOP_SCENARIO_IDS = [
  "scenario-medium-13",
  "scenario-complex-01",
] as const;

export const PHASE_27_LIVE_REPEATED_CORRECTION_SCENARIO_IDS = [
  "scenario-medium-11-reference-slot-zh",
  "scenario-medium-13-reference-slot",
] as const;

export const PHASE_27_FALLBACK_SCENARIO_IDS = [
  ...PHASE_27_IDENTITY_BACKGROUND_SCENARIO_IDS,
  ...PHASE_27_CONTINUATION_OPEN_LOOP_SCENARIO_IDS,
  ...PHASE_27_REPEATED_CORRECTION_SCENARIO_IDS,
] as const;

export const PHASE_27_LIVE_SCENARIO_IDS = [
  ...PHASE_27_LIVE_CONTINUATION_OPEN_LOOP_SCENARIO_IDS,
  ...PHASE_27_LIVE_REPEATED_CORRECTION_SCENARIO_IDS,
] as const;

const PHASE_27_LOCAL_DEFAULT_RUNTIME_ENV_KEYS = [
  "GOODMEMORY_STORAGE_PROVIDER",
  "GOODMEMORY_STORAGE_URL",
  "GOODMEMORY_EMBEDDING_PROVIDER",
  "GOODMEMORY_EMBEDDING_MODEL",
  "GOODMEMORY_EMBEDDING_API_KEY",
  "GOODMEMORY_EMBEDDING_BASE_URL",
  "GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER",
  "GOODMEMORY_ASSISTED_EXTRACTOR_MODEL",
  "GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY",
  "GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL",
  "GOODMEMORY_SQLITE_CUSTOM_LIBRARY_PATH",
  "GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH",
  "GOODMEMORY_SQLITE_VECTOR_EXTENSION_ENTRYPOINT",
  "GOODMEMORY_SQLITE_VECTOR_MODE",
  "GOODMEMORY_SQLITE_VECTOR_SEARCH_FUNCTION",
] as const;

export type Phase27ScenarioFamily =
  | "identity_background"
  | "continuation_open_loop"
  | "repeated_correction";

export interface Phase27CreateMemoryInput {
  caseId: string;
  persona: PersonaSpec;
  scenario: ScenarioFixture;
  scopeNamespace: string;
}

export type Phase27CreateMemoryResult =
  | GoodMemory
  | {
      cleanup?: () => Promise<void>;
      memory: GoodMemory;
    };

export interface Phase27ScenarioWinnerCase {
  caseId: string;
  scenarioId: string;
  winner: "baseline" | "goodmemory" | "tie";
}

export interface Phase27WinnerMetric {
  family: Exclude<Phase27ScenarioFamily, "repeated_correction">;
  goodmemoryWins: number;
  baselineWins: number;
  ties: number;
  totalCases: number;
  requiredCases: number;
  passed: boolean;
  threshold: string;
  cases: Phase27ScenarioWinnerCase[];
}

export interface Phase27RepeatedCorrectionCase {
  baselineRepeated: boolean;
  caseId: string;
  goodmemoryRepeated: boolean;
  scenarioId: string;
  winner: "baseline" | "goodmemory" | "tie";
}

export interface Phase27RepeatedCorrectionMetric {
  baselineRepeatedCorrectionRate: number;
  cases: Phase27RepeatedCorrectionCase[];
  goodmemoryRepeatedCorrectionRate: number;
  improvement: number;
  passed: boolean;
  requiredCases: number;
  threshold: string;
  totalCases: number;
}

export interface Phase27CodexHandoffCase {
  caseId: string;
  details: string;
  passed: boolean;
}

export interface Phase27CodexHandoffSummary {
  cases: Phase27CodexHandoffCase[];
  passed: boolean;
  passedCases: number;
  requiredCases: number;
  successRate: number;
  threshold: string;
  totalCases: number;
}

export interface Phase27LiveFamilyCoverage {
  family: "continuation_open_loop" | "repeated_correction";
  goodmemoryWins: number;
  baselineWins: number;
  ties: number;
  totalCases: number;
  requiredCases: number;
  passed: boolean;
  threshold: string;
  cases: Phase27ScenarioWinnerCase[];
}

export interface Phase27LiveWinnerSummary {
  baselineWins: number;
  goodmemoryWins: number;
  passed: boolean;
  threshold: string;
  ties: number;
  totalCases: number;
}

export interface Phase27ContractCheck {
  details: string;
  name: string;
  passed: boolean;
}

export interface Phase27ReferenceSetupMetric {
  assistedExtractionEnabled: boolean;
  createMemoryEntrypoint: string;
  embeddingEnabled: boolean;
  explicitAdaptersConfigured: boolean;
  explicitStorageConfigured: boolean;
  passed: boolean;
  runtimeStorage: string;
  threshold: string;
  checks: Phase27ContractCheck[];
}

export interface Phase27PublicSurfacePurityMetric {
  allowedImports: string[];
  checkedFiles: string[];
  packageBoundarySmoke: "package-name-imports";
  passed: boolean;
  threshold: string;
  checks: Phase27ContractCheck[];
}

export interface Phase27LiveMemoryReport {
  generatedAt: string;
  generatedBy: string;
  mode: "live-memory";
  outputDir: string;
  runDirectory: string;
  runId: string;
  suiteRunDirectory: string;
  suiteSummary: EvalSuiteResult["summary"];
  metrics: {
    continuationOpenLoop: Phase27LiveFamilyCoverage;
    liveWinnerSummary: Phase27LiveWinnerSummary;
    repeatedCorrectionRate: Phase27RepeatedCorrectionMetric;
  };
  summary: {
    accepted: boolean;
    blockingMetrics: string[];
    executionFailures: number;
    totalScenarioCases: number;
  };
}

export interface Phase27DeterministicReport {
  generatedAt: string;
  generatedBy: string;
  mode: "fallback";
  outputDir: string;
  runDirectory: string;
  runId: string;
  suiteRunDirectory: string;
  suiteSummary: EvalSuiteResult["summary"];
  metrics: {
    continuationOpenLoop: Phase27WinnerMetric;
    hostHandoffResumeSuccessRate: Phase27CodexHandoffSummary;
    identityBackground: Phase27WinnerMetric;
    publicSurfacePurity: Phase27PublicSurfacePurityMetric;
    referenceSetup: Phase27ReferenceSetupMetric;
    repeatedCorrectionRate: Phase27RepeatedCorrectionMetric;
  };
  summary: {
    accepted: boolean;
    blockingMetrics: string[];
    executionFailures: number;
    totalScenarioCases: number;
  };
}

function uniqueScenarioIds(
  ids: readonly string[],
): string[] {
  return [...new Set(ids)];
}

function withPhase27LocalDefaultRuntime<TValue>(
  root: string,
  run: () => TValue,
): TValue {
  if (!existsSync(root)) {
    throw new Error(
      `Phase 27 local-default runtime root does not exist: ${root}`,
    );
  }

  const previousCwd = process.cwd();
  const previousValues = PHASE_27_LOCAL_DEFAULT_RUNTIME_ENV_KEYS.map((key) =>
    [key, process.env[key]] as const
  );

  for (const [key] of previousValues) {
    delete process.env[key];
  }

  process.chdir(root);

  try {
    return run();
  } finally {
    process.chdir(previousCwd);

    for (const [key, value] of previousValues) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }

      process.env[key] = value;
    }
  }
}

function buildPhase27FallbackMemoryConfig(): GoodMemoryConfig {
  return {};
}

interface Phase27ReferenceSetupObservation {
  assistedExtractionEnabled: boolean;
  createMemoryEntrypoint: "createGoodMemory({})";
  embeddingEnabled: boolean;
  explicitAdaptersConfigured: boolean;
  explicitStorageConfigured: boolean;
  resolvedSqliteUrl: string | null;
  runtimeStorage: "local-default-sqlite" | "other";
}

export function inspectPhase27FallbackReferenceSetup(
  root: string,
): Phase27ReferenceSetupObservation {
  return withPhase27LocalDefaultRuntime(root, () => {
    const config = buildPhase27FallbackMemoryConfig();
    const runtimeResolution = resolveGoodMemoryRuntimeResolution({
      config,
      cwd: process.cwd(),
    });
    const resolvedSqliteUrl =
      runtimeResolution.storagePlan.mode === "auto"
        ? "sqliteUrl" in runtimeResolution.storagePlan
          ? runtimeResolution.storagePlan.sqliteUrl
          : null
        : runtimeResolution.storagePlan.storage.provider === "sqlite"
          ? runtimeResolution.storagePlan.storage.url
          : null;
    const runtimeStorage =
      runtimeResolution.storagePlan.mode === "auto" &&
      runtimeResolution.storagePlan.postgresUrl === undefined &&
      resolvedSqliteUrl?.endsWith(DEFAULT_SQLITE_STORAGE_PATH) === true
        ? "local-default-sqlite"
        : "other";

    return {
      assistedExtractionEnabled: runtimeResolution.assistedExtractionEnabled,
      createMemoryEntrypoint: "createGoodMemory({})",
      embeddingEnabled: runtimeResolution.embeddingEnabled,
      explicitAdaptersConfigured: runtimeResolution.explicitAdaptersConfigured,
      explicitStorageConfigured: runtimeResolution.explicitStorageConfigured,
      resolvedSqliteUrl,
      runtimeStorage,
    };
  });
}

function createPhase27LocalDefaultRuntimeMemory(root: string) {
  return withPhase27LocalDefaultRuntime(root, () => {
    const config = buildPhase27FallbackMemoryConfig();
    const runtimeResolution = resolveGoodMemoryRuntimeResolution({
      config,
      cwd: process.cwd(),
    });
    const sqliteUrl =
      runtimeResolution.storagePlan.mode === "auto"
        ? "sqliteUrl" in runtimeResolution.storagePlan
          ? runtimeResolution.storagePlan.sqliteUrl
          : null
        : runtimeResolution.storagePlan.storage.provider === "sqlite"
          ? runtimeResolution.storagePlan.storage.url
          : null;

    if (!sqliteUrl) {
      throw new Error("Phase 27 fallback runtime must resolve to a local sqlite backend.");
    }

    return {
      documentStore: createSQLiteDocumentStore(sqliteUrl),
      memory: createGoodMemory(config),
      sessionStore: createSQLiteSessionStore(sqliteUrl),
    };
  });
}

export function resolvePhase27FallbackScenarioIds(explicit?: string[]): string[] {
  if (explicit && explicit.length > 0) {
    return uniqueScenarioIds(explicit);
  }

  return uniqueScenarioIds(PHASE_27_FALLBACK_SCENARIO_IDS);
}

export function resolvePhase27LiveScenarioIds(explicit?: string[]): string[] {
  if (explicit && explicit.length > 0) {
    return uniqueScenarioIds(explicit);
  }

  return uniqueScenarioIds(PHASE_27_LIVE_SCENARIO_IDS);
}

export function createPhase27FallbackCreateMemory(): (
  input: Phase27CreateMemoryInput,
) => Phase27CreateMemoryResult {
  return () => {
    const root = mkdtempSync(join(tmpdir(), "goodmemory-phase27-default-"));

    return {
      memory: createPhase27LocalDefaultRuntimeMemory(root).memory,
      cleanup: async () => {
        await rm(root, {
          force: true,
          recursive: true,
        });
      },
    };
  };
}

function roundMetric(value: number): number {
  return Number(value.toFixed(2));
}

function buildScenarioMap(
  scenarios: readonly ScenarioFixture[],
): Map<string, ScenarioFixture> {
  return new Map(scenarios.map((scenario) => [scenario.scenario_id, scenario]));
}

function buildWinnerMetric(input: {
  family: Exclude<Phase27ScenarioFamily, "repeated_correction">;
  requiredCases: number;
  scenarioIds: readonly string[];
  suiteResult: EvalSuiteResult;
}): Phase27WinnerMetric {
  const cases = input.suiteResult.cases
    .filter((caseArtifact: JudgedEvalCase) =>
      input.scenarioIds.includes(caseArtifact.goodmemory.scenarioId),
    )
    .map((caseArtifact: JudgedEvalCase) => ({
      caseId: caseArtifact.caseId,
      scenarioId: caseArtifact.goodmemory.scenarioId,
      winner: caseArtifact.judge.winner,
    }));
  const goodmemoryWins = cases.filter(
    (item: Phase27ScenarioWinnerCase) => item.winner === "goodmemory",
  ).length;
  const baselineWins = cases.filter(
    (item: Phase27ScenarioWinnerCase) => item.winner === "baseline",
  ).length;
  const ties = cases.filter(
    (item: Phase27ScenarioWinnerCase) => item.winner === "tie",
  ).length;
  const totalCases = cases.length;

  const passed = input.family === "identity_background"
    ? totalCases >= input.requiredCases && goodmemoryWins >= 2
    : totalCases >= input.requiredCases &&
        goodmemoryWins - baselineWins >= 2 &&
        baselineWins <= 1;

  return {
    family: input.family,
    goodmemoryWins,
    baselineWins,
    ties,
    totalCases,
    requiredCases: input.requiredCases,
    passed,
    threshold: input.family === "identity_background"
      ? "GoodMemory wins at least 2 of 3 cases."
      : "GoodMemory posts at least 2 net wins and baseline wins at most 1 case.",
    cases,
  };
}

function buildLiveFamilyCoverage(input: {
  family: "continuation_open_loop" | "repeated_correction";
  requiredCases: number;
  scenarioIds: readonly string[];
  suiteResult: EvalSuiteResult;
}): Phase27LiveFamilyCoverage {
  const cases = input.suiteResult.cases
    .filter((caseArtifact: JudgedEvalCase) =>
      input.scenarioIds.includes(caseArtifact.goodmemory.scenarioId),
    )
    .map((caseArtifact: JudgedEvalCase) => ({
      caseId: caseArtifact.caseId,
      scenarioId: caseArtifact.goodmemory.scenarioId,
      winner: caseArtifact.judge.winner,
    }));
  const goodmemoryWins = cases.filter(
    (item: Phase27ScenarioWinnerCase) => item.winner === "goodmemory",
  ).length;
  const baselineWins = cases.filter(
    (item: Phase27ScenarioWinnerCase) => item.winner === "baseline",
  ).length;
  const ties = cases.filter(
    (item: Phase27ScenarioWinnerCase) => item.winner === "tie",
  ).length;

  return {
    family: input.family,
    goodmemoryWins,
    baselineWins,
    ties,
    totalCases: cases.length,
    requiredCases: input.requiredCases,
    passed: cases.length >= input.requiredCases,
    threshold: `Cover at least ${input.requiredCases} live cases in the ${input.family} family.`,
    cases,
  };
}

function isRepeatedCorrection(input: {
  answer: string;
  scenario: ScenarioFixture;
}): boolean {
  const answer = input.answer;
  const staleSignals = input.scenario.evaluation.expected_stale_suppression;
  const updateSignals = input.scenario.evaluation.expected_update_wins;
  const staleLeakCount = findAffirmedSignals(staleSignals, answer).length;
  const missingUpdateCount = findMissingAffirmedSignals(updateSignals, answer).length;

  return staleLeakCount > 0 || missingUpdateCount > 0;
}

function buildRepeatedCorrectionMetric(input: {
  requiredCases: number;
  scenarioIds: readonly string[];
  scenarios: readonly ScenarioFixture[];
  suiteResult: EvalSuiteResult;
}): Phase27RepeatedCorrectionMetric {
  const scenarioMap = buildScenarioMap(input.scenarios);
  const cases = input.suiteResult.cases
    .filter((caseArtifact: JudgedEvalCase) =>
      input.scenarioIds.includes(caseArtifact.goodmemory.scenarioId),
    )
    .map((caseArtifact: JudgedEvalCase) => {
      const scenario = scenarioMap.get(caseArtifact.goodmemory.scenarioId);
      if (!scenario) {
        throw new Error(
          `Missing scenario fixture for Phase 27 repeated-correction case ${caseArtifact.goodmemory.scenarioId}`,
        );
      }

      return {
        baselineRepeated: isRepeatedCorrection({
          answer: caseArtifact.baseline.answer,
          scenario,
        }),
        caseId: caseArtifact.caseId,
        goodmemoryRepeated: isRepeatedCorrection({
          answer: caseArtifact.goodmemory.answer,
          scenario,
        }),
        scenarioId: caseArtifact.goodmemory.scenarioId,
        winner: caseArtifact.judge.winner,
      };
    });
  const totalCases = cases.length;
  const baselineRepeatedCount = cases.filter(
    (item: Phase27RepeatedCorrectionCase) => item.baselineRepeated,
  ).length;
  const goodmemoryRepeatedCount = cases.filter(
    (item: Phase27RepeatedCorrectionCase) => item.goodmemoryRepeated,
  ).length;
  const baselineRepeatedCorrectionRate = roundMetric(
    baselineRepeatedCount / Math.max(totalCases, 1),
  );
  const goodmemoryRepeatedCorrectionRate = roundMetric(
    goodmemoryRepeatedCount / Math.max(totalCases, 1),
  );
  const improvement = roundMetric(
    baselineRepeatedCorrectionRate - goodmemoryRepeatedCorrectionRate,
  );

  return {
    baselineRepeatedCorrectionRate,
    cases,
    goodmemoryRepeatedCorrectionRate,
    improvement,
    passed: totalCases >= input.requiredCases && improvement >= 0.25,
    requiredCases: input.requiredCases,
    threshold: "GoodMemory reduces repeated-correction rate by at least 25 percentage points.",
    totalCases,
  };
}

function createBaseExportResult(): ExportMemoryResult {
  return {
    pages: buildPageArtifacts({ notes: [] }),
    artifacts: {
      rootPath: ".goodmemory/users/u-1/workspaces/ws-1/sessions/s-1",
      files: [
        {
          kind: "memory",
          relativePath: "MEMORY.md",
          content: "# MEMORY",
        },
        {
          kind: "session",
          relativePath: "session.md",
          sessionId: "s-1",
          content: "# Session Memory: s-1",
        },
      ],
    },
    scope: {
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
    },
    exportedAt: "2026-04-21T00:00:00.000Z",
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
    runtime: {
      workingMemory: null,
      journal: null,
      spills: [],
    },
  };
}

async function runCodexBasicResumeCase(): Promise<void> {
  const workspace = await mkdtemp(
    join(tmpdir(), "goodmemory-phase27-handoff-basic-"),
  );
  const { documentStore, memory, sessionStore } =
    createPhase27LocalDefaultRuntimeMemory(workspace);
  const runtime = createRuntimeContextService({
    archiveStore: createRuntimeArchiveStore({ documentStore }),
    maxBufferedMessages: 2,
    now: () => "2026-04-21T00:00:00.000Z",
    sessionStore,
  });

  const scope = {
    userId: "codex-user",
    sessionId: "agent-s1",
    workspaceId: "codex-workspace",
  } as const;

  try {
    await runtime.startSession(scope);
    await runtime.updateWorkingMemory(scope, {
      currentGoal: "Finish recall engine",
      openLoops: ["wire buildContext output"],
      temporaryDecisions: ["Reuse the runtime runbook before deploy."],
    });
    await runtime.updateSessionJournal(scope, {
      currentState: "Recall router implemented.",
      filesAndFunctions: ["src/recall/engine.ts", "src/recall/contextBuilder.ts"],
      workflow: ["Verify the runtime runbook", "Wire buildContext output"],
      appendWorklog: ["Confirmed the recall router path."],
    });
    await memory.feedback({
      scope,
      signal: "Keep coding task updates concise and action-oriented.",
    });

    const adapter = createHostAdapter({
      id: "phase27-codex-basic",
      hostKind: "codex",
      memory,
      readableArtifactTypes: ["session_memory"],
    });
    const result = await adapter.readArtifacts({
      scope,
      includeRuntime: true,
    });
    const artifact = result.artifacts[0];
    if (!artifact) {
      throw new Error("Expected one session-memory artifact.");
    }
    if (!artifact.content.includes("Finish recall engine")) {
      throw new Error("Session handoff is missing the current goal.");
    }
    if (!artifact.content.includes("wire buildContext output")) {
      throw new Error("Session handoff is missing the open loop.");
    }
    if (!artifact.content.includes("Keep coding task updates concise and action-oriented.")) {
      throw new Error("Session handoff is missing procedural memory.");
    }
  } finally {
    await rm(workspace, {
      force: true,
      recursive: true,
    });
  }
}

async function runCodexRefreshCase(): Promise<void> {
  const workspace = await mkdtemp(
    join(tmpdir(), "goodmemory-phase27-handoff-refresh-"),
  );
  const { documentStore, memory, sessionStore } =
    createPhase27LocalDefaultRuntimeMemory(workspace);
  const runtime = createRuntimeContextService({
    archiveStore: createRuntimeArchiveStore({ documentStore }),
    maxBufferedMessages: 2,
    now: () => "2026-04-21T00:00:00.000Z",
    sessionStore,
  });

  const scope = {
    userId: "codex-user",
    sessionId: "agent-s1",
    workspaceId: "codex-workspace",
  } as const;

  try {
    await runtime.startSession(scope);
    await runtime.updateWorkingMemory(scope, {
      currentGoal: "Finish recall engine",
      openLoops: ["wire buildContext output"],
    });
    await memory.feedback({
      scope,
      signal: "Keep coding task updates concise and action-oriented.",
    });

    const adapter = createHostAdapter({
      id: "phase27-codex-refresh",
      hostKind: "codex",
      memory,
      readableArtifactTypes: ["session_memory"],
    });

    const first = await adapter.readArtifacts({
      scope,
      includeRuntime: true,
    });
    if (!first.artifacts[0]?.content.includes("Finish recall engine")) {
      throw new Error("Initial handoff is missing the original goal.");
    }

    await runtime.updateWorkingMemory(scope, {
      currentGoal: "Ship host adapter",
      openLoops: ["close the Phase 27 gate"],
    });

    const second = await adapter.readArtifacts({
      scope,
      includeRuntime: true,
    });
    const content = second.artifacts[0]?.content ?? "";
    if (!content.includes("Ship host adapter")) {
      throw new Error("Refreshed handoff did not project the new goal.");
    }
    if (content.includes("Finish recall engine")) {
      throw new Error("Refreshed handoff still contains the superseded goal.");
    }
  } finally {
    await rm(workspace, {
      force: true,
      recursive: true,
    });
  }
}

async function runCodexActiveOnlyCase(): Promise<void> {
  const source = createMemorySource({
    method: "explicit",
    extractedAt: "2026-04-21T00:00:00.000Z",
    sessionId: "s-1",
  });
  const base = createBaseExportResult();
  const exported: ExportMemoryResult = {
    ...base,
    durable: {
      ...base.durable,
      references: [
        createReferenceMemory({
          id: "ref-active",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          title: "Runtime runbook",
          pointer: "docs/runtime-runbook.md",
          source,
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
        }),
        createReferenceMemory({
          id: "ref-superseded",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          title: "Old runtime runbook",
          pointer: "docs/runtime-runbook-v1.md",
          source,
          createdAt: "2026-04-21T00:00:00.000Z",
          lifecycle: "superseded",
          updatedAt: "2026-04-21T00:00:00.000Z",
        }),
      ],
      feedback: [
        createFeedbackMemory({
          id: "feedback-active",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          rule: "Use pnpm.",
          kind: "validated_pattern",
          source,
          updatedAt: "2026-04-21T00:00:00.000Z",
        }),
        createFeedbackMemory({
          id: "feedback-superseded",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          rule: "Use npm.",
          kind: "validated_pattern",
          source,
          lifecycle: "superseded",
          supersededBy: "feedback-active",
          updatedAt: "2026-04-21T00:00:00.000Z",
        }),
      ],
    },
  };
  const adapter = createHostAdapter({
    id: "phase27-codex-active-only",
    hostKind: "codex",
    memory: {
      async exportMemory() {
        return exported;
      },
    },
    readableArtifactTypes: ["session_memory"],
  });
  const result = await adapter.readArtifacts({
    scope: {
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
    },
    includeRuntime: true,
  });
  const content = result.artifacts[0]?.content ?? "";

  if (!content.includes("Use pnpm.")) {
    throw new Error("Session handoff did not retain the active procedural memory.");
  }
  if (content.includes("Use npm.")) {
    throw new Error("Session handoff surfaced superseded procedural guidance.");
  }
  if (content.includes("docs/runtime-runbook-v1.md")) {
    throw new Error("Session handoff surfaced superseded reference guidance.");
  }
}

async function executeCodexCase(
  caseId: string,
  run: () => Promise<void>,
): Promise<Phase27CodexHandoffCase> {
  try {
    await run();
    return {
      caseId,
      details: "passed",
      passed: true,
    };
  } catch (error) {
    return {
      caseId,
      details: error instanceof Error ? error.message : String(error),
      passed: false,
    };
  }
}

export async function runPhase27CodexHandoffFamily(): Promise<Phase27CodexHandoffSummary> {
  const cases = await Promise.all([
    executeCodexCase("codex-basic-session-handoff", runCodexBasicResumeCase),
    executeCodexCase("codex-handoff-refresh", runCodexRefreshCase),
    executeCodexCase("codex-active-only-projection", runCodexActiveOnlyCase),
  ]);
  const passedCases = cases.filter((item) => item.passed).length;
  const totalCases = cases.length;
  const successRate = roundMetric(passedCases / Math.max(totalCases, 1));

  return {
    cases,
    passed: totalCases === 3 && passedCases === totalCases,
    passedCases,
    requiredCases: 3,
    successRate,
    threshold: "All 3 Codex handoff/resume cases must pass.",
    totalCases,
  };
}

export function buildPhase27DeterministicReport(input: {
  generatedAt: string;
  generatedBy: string;
  handoffSummary: Phase27CodexHandoffSummary;
  outputDir: string;
  publicSurfacePurity: Phase27PublicSurfacePurityMetric;
  referenceSetup: Phase27ReferenceSetupMetric;
  runDirectory: string;
  runId: string;
  scenarios: readonly ScenarioFixture[];
  suiteResult: EvalSuiteResult;
}): Phase27DeterministicReport {
  const executionFailures = input.suiteResult.summary.executionFailures ?? 0;
  const identityBackground = buildWinnerMetric({
    family: "identity_background",
    requiredCases: 3,
    scenarioIds: PHASE_27_IDENTITY_BACKGROUND_SCENARIO_IDS,
    suiteResult: input.suiteResult,
  });
  const continuationOpenLoop = buildWinnerMetric({
    family: "continuation_open_loop",
    requiredCases: 6,
    scenarioIds: PHASE_27_CONTINUATION_OPEN_LOOP_SCENARIO_IDS,
    suiteResult: input.suiteResult,
  });
  const repeatedCorrectionRate = buildRepeatedCorrectionMetric({
    requiredCases: 4,
    scenarioIds: PHASE_27_REPEATED_CORRECTION_SCENARIO_IDS,
    scenarios: input.scenarios,
    suiteResult: input.suiteResult,
  });
  const blockingMetrics = [
    !identityBackground.passed ? "identity_background_score" : null,
    !continuationOpenLoop.passed ? "continuation_open_loop_score" : null,
    !repeatedCorrectionRate.passed ? "repeated_correction_rate" : null,
    !input.handoffSummary.passed ? "host_handoff_resume_success_rate" : null,
    !input.referenceSetup.passed ? "reference_setup" : null,
    !input.publicSurfacePurity.passed ? "public_surface_purity" : null,
    executionFailures > 0 ? "execution_failures" : null,
  ].filter((value): value is string => value !== null);

  return {
    generatedAt: input.generatedAt,
    generatedBy: input.generatedBy,
    mode: "fallback",
    outputDir: input.outputDir,
    runDirectory: input.runDirectory,
    runId: input.runId,
    suiteRunDirectory: input.suiteResult.runDirectory,
    suiteSummary: input.suiteResult.summary,
    metrics: {
      continuationOpenLoop,
      hostHandoffResumeSuccessRate: input.handoffSummary,
      identityBackground,
      publicSurfacePurity: input.publicSurfacePurity,
      referenceSetup: input.referenceSetup,
      repeatedCorrectionRate,
    },
    summary: {
      accepted: blockingMetrics.length === 0,
      blockingMetrics,
      executionFailures,
      totalScenarioCases: input.suiteResult.cases.length,
    },
  };
}

export function buildPhase27LiveMemoryReport(input: {
  generatedAt: string;
  generatedBy: string;
  outputDir: string;
  runDirectory: string;
  runId: string;
  scenarios: readonly ScenarioFixture[];
  suiteResult: EvalSuiteResult;
}): Phase27LiveMemoryReport {
  const executionFailures = input.suiteResult.summary.executionFailures ?? 0;
  const continuationOpenLoop = buildLiveFamilyCoverage({
    family: "continuation_open_loop",
    requiredCases: 2,
    scenarioIds: PHASE_27_LIVE_CONTINUATION_OPEN_LOOP_SCENARIO_IDS,
    suiteResult: input.suiteResult,
  });
  const repeatedCorrectionRate = buildRepeatedCorrectionMetric({
    requiredCases: 2,
    scenarioIds: PHASE_27_LIVE_REPEATED_CORRECTION_SCENARIO_IDS,
    scenarios: input.scenarios,
    suiteResult: input.suiteResult,
  });
  const liveWinnerSummary = {
    baselineWins: input.suiteResult.summary.winnerCounts.baseline,
    goodmemoryWins: input.suiteResult.summary.winnerCounts.goodmemory,
    passed:
      input.suiteResult.cases.length >= 4 &&
      input.suiteResult.summary.winnerCounts.goodmemory >
        input.suiteResult.cases.length / 2 &&
      input.suiteResult.summary.winnerCounts.baseline <= 1,
    threshold:
      "GoodMemory wins a strict majority of live cases and baseline wins at most 1 case.",
    ties: input.suiteResult.summary.winnerCounts.tie,
    totalCases: input.suiteResult.cases.length,
  } satisfies Phase27LiveWinnerSummary;
  const blockingMetrics = [
    !continuationOpenLoop.passed ? "continuation_open_loop_coverage" : null,
    !repeatedCorrectionRate.passed ? "repeated_correction_rate" : null,
    !liveWinnerSummary.passed ? "live_winner_majority" : null,
    executionFailures > 0 ? "execution_failures" : null,
  ].filter((value): value is string => value !== null);

  return {
    generatedAt: input.generatedAt,
    generatedBy: input.generatedBy,
    mode: "live-memory",
    outputDir: input.outputDir,
    runDirectory: input.runDirectory,
    runId: input.runId,
    suiteRunDirectory: input.suiteResult.runDirectory,
    suiteSummary: input.suiteResult.summary,
    metrics: {
      continuationOpenLoop,
      liveWinnerSummary,
      repeatedCorrectionRate,
    },
    summary: {
      accepted: blockingMetrics.length === 0,
      blockingMetrics,
      executionFailures,
      totalScenarioCases: input.suiteResult.cases.length,
    },
  };
}
