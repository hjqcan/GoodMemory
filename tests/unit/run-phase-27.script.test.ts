import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { EvalSuiteSummary, JudgedEvalCase } from "../../src/eval/contracts";
import {
  PHASE_27_CONTINUATION_OPEN_LOOP_SCENARIO_IDS,
  PHASE_27_FALLBACK_SCENARIO_IDS,
  PHASE_27_IDENTITY_BACKGROUND_SCENARIO_IDS,
  PHASE_27_LIVE_CONTINUATION_OPEN_LOOP_SCENARIO_IDS,
  PHASE_27_LIVE_REPEATED_CORRECTION_SCENARIO_IDS,
  PHASE_27_LIVE_SCENARIO_IDS,
  PHASE_27_REPEATED_CORRECTION_SCENARIO_IDS,
  createPhase27FallbackCreateMemory,
  runPhase27CodexHandoffFamily,
} from "../../src/eval/phase27";
import type { PersonaSpec, ScenarioFixture } from "../../src/eval/dataset";
import {
  createNoopGoodMemoryJobsFacade,
  createNoopGoodMemoryRuntimeFacade,
} from "../../src/testing/fakes";
import {
  buildPhase27ReferenceSetupMetric,
  parsePhase27EvalCliOptions,
  resolvePhase27FallbackOutputDir,
  runPhase27FallbackEval,
} from "../../scripts/run-phase-27-eval";
import {
  parsePhase27LiveMemoryCliOptions,
  resolvePhase27LiveMemoryOutputDir,
  runPhase27LiveMemoryEval,
} from "../../scripts/run-phase-27-live-memory";

function buildJudgeScores() {
  return {
    factual_recall: 0,
    preference_consistency: 0,
    cross_domain_transfer: 0,
    contamination_penalty: 0,
    update_correctness: 0,
    personalization_usefulness: 0,
    provenance_explainability: 0,
  };
}

function buildSummary(
  totalCases: number,
  overrides: Partial<EvalSuiteSummary> = {},
): EvalSuiteSummary {
  return {
    totalCases,
    completedCases: totalCases,
    executionFailures: 0,
    winnerCounts: {
      baseline: 1,
      goodmemory: totalCases - 2,
      tie: 1,
    },
    baselineAverage: buildJudgeScores(),
    goodmemoryAverage: buildJudgeScores(),
    uplift: buildJudgeScores(),
    layers: {
      baseline: { retrieval: 0, personalization: 0, runtime_governance: 0 },
      goodmemory: { retrieval: 0, personalization: 0, runtime_governance: 0 },
      uplift: { retrieval: 0, personalization: 0, runtime_governance: 0 },
    },
    assertions: {
      totalCases,
      passingCases: totalCases,
      passRate: 1,
      totalChecks: totalCases,
      passingChecks: totalCases,
      checkPassRate: 1,
      applicableStaleSuppressionCases: 0,
      applicableUpdateCases: 0,
      contaminationFailures: 0,
      staleMisuseCases: 0,
      staleMisuseRate: 0,
      staleSuppressionCases: 0,
      staleSuppressionRate: 0,
      updateWinCases: 0,
      updateWinRate: 0,
      updateFailures: 0,
    },
    strategySummary: {
      byStrategy: {
        "rules-only": {
          totalCases,
          uniqueScenarios: totalCases,
          winnerCounts: {
            baseline: 1,
            goodmemory: totalCases - 2,
            tie: 1,
          },
          uplift: buildJudgeScores(),
          regressionCases: [],
        },
      },
      embeddingImpact: null,
      routerImpact: null,
    },
    ...overrides,
  };
}

function buildScenarioFixture(
  scenarioId: string,
): ScenarioFixture {
  const isCorrection = PHASE_27_REPEATED_CORRECTION_SCENARIO_IDS.includes(
    scenarioId as (typeof PHASE_27_REPEATED_CORRECTION_SCENARIO_IDS)[number],
  );
  const isIdentity = PHASE_27_IDENTITY_BACKGROUND_SCENARIO_IDS.includes(
    scenarioId as (typeof PHASE_27_IDENTITY_BACKGROUND_SCENARIO_IDS)[number],
  );

  return {
    scenario_id: scenarioId,
    persona_id: "phase27-test-persona",
    lifecycle_bucket: "medium",
    task_family: "preference_continuation",
    domain: "work_ops",
    memory_source_domains: ["work_ops"],
    evaluation_setting: "single_domain",
    required_phenomena: [
      "identity_reveal",
      "historical_task_continuation",
      "open_loop",
      "correction",
      "confirmation",
      "stale_info",
    ],
    sessions: [
      {
        session_id: `${scenarioId}-s1`,
        objective: "Replay prior history.",
        turns: [
          {
            role: "user",
            content: "Remember the corrected runbook and current role.",
          },
          {
            role: "assistant",
            content: "Understood.",
          },
        ],
      },
      {
        session_id: `${scenarioId}-s2`,
        objective: "Ask the final prompt.",
        turns: [
          {
            role: "user",
            content: "What should we continue next?",
          },
          {
            role: "assistant",
            content: "I need remembered context to answer.",
          },
        ],
      },
    ],
    evaluation: {
      prompt: "What should we continue next?",
      rubric_focus: ["identity_background", "history_open_loop"],
      expected_identity_signals: isIdentity
        ? ["data scientist", "Singapore"]
        : ["data scientist"],
      expected_history_signals: ["final verification"],
      expected_transfer_signals: ["final verification"],
      expected_non_transfer_signals: [],
      expected_update_wins: isCorrection ? ["docs/current-runbook.md"] : [],
      expected_stale_suppression: isCorrection ? ["docs/old-runbook.md"] : [],
      wrong_personalization_signals: [],
      improvement_hypothesis: "GoodMemory should beat baseline on remembered continuity.",
      user_satisfaction_hypothesis: "The answer should resume from the corrected state.",
    },
    feedback_signals: [],
  };
}

function buildPersonaFixture(): PersonaSpec {
  return {
    persona_id: "phase27-test-persona",
    name: "Noah",
    age_range: "30-39",
    locale: "en-US",
    profession: "data scientist",
    expertise: ["workflow reliability"],
    background: "Works on workflow reliability dashboard.",
    communication_preferences: ["concise"],
    work_style_preferences: ["written decisions"],
    long_term_goals: ["ship reliable systems"],
    current_projects: ["workflow reliability dashboard"],
    growth_path: ["staff engineer"],
    known_relationships: ["platform lead"],
    memory_risks: ["stale references"],
    domains: ["work_ops"],
    stable_preferences: ["concise bullet points"],
    domain_specific_preferences: ["risk-first summaries"],
    drift_events: ["runbook correction"],
    negative_personalization_risks: ["reference spill"],
    lifecycle_bucket: "medium",
    scenario_ids: [],
  };
}

function buildVisibleTranscriptScenarioFixture(): ScenarioFixture {
  return {
    scenario_id: "scenario-medium-13",
    persona_id: "phase27-test-persona",
    lifecycle_bucket: "medium",
    task_family: "preference_continuation",
    domain: "work_ops",
    memory_source_domains: ["work_ops"],
    evaluation_setting: "single_domain",
    required_phenomena: [
      "identity_reveal",
      "historical_task_continuation",
      "open_loop",
      "correction",
      "confirmation",
      "stale_info",
    ],
    sessions: [],
    evaluation: {
      prompt:
        "Please confirm the updated runbook, my role, and the open loop before proposing the next step for workflow reliability dashboard.",
      rubric_focus: ["identity_background", "history_open_loop"],
      expected_identity_signals: [
        "Data scientist",
        "Singapore",
        "concise bullet points",
      ],
      expected_history_signals: [
        "docs/workflow-reliability-dashboard-runbook-v2.md",
        "final verification for workflow reliability dashboard",
        "workflow reliability dashboard",
      ],
      expected_transfer_signals: ["concise bullet points"],
      expected_non_transfer_signals: [],
      expected_update_wins: ["docs/workflow-reliability-dashboard-runbook-v2.md"],
      expected_stale_suppression: ["docs/workflow-reliability-dashboard-runbook-v1.md"],
      wrong_personalization_signals: [],
      improvement_hypothesis:
        "GoodMemory should beat baseline by combining the corrected runbook and open loop.",
      user_satisfaction_hypothesis:
        "The answer should preserve the user's confirmed style while continuing the task.",
    },
    feedback_signals: [],
  };
}

function buildCase(
  scenarioId: string,
  winner: "baseline" | "goodmemory" | "tie",
  baselineAnswer: string,
  goodmemoryAnswer: string,
): JudgedEvalCase {
  return {
    caseId: scenarioId,
    metadata: {
      taskFamily: "preference_continuation",
      targetDomain: "work_ops",
      memorySourceDomains: ["work_ops"],
      evaluationSetting: "single_domain",
      strategyLabel: "rules-only",
    },
    baseline: {
      mode: "baseline",
      strategyLabel: "baseline",
      personaId: "phase27-test-persona",
      scenarioId,
      taskFamily: "preference_continuation",
      targetDomain: "work_ops",
      memorySourceDomains: ["work_ops"],
      evaluationSetting: "single_domain",
      prompt: "What should we continue next?",
      transcript: "user: What should we continue next?",
      answer: baselineAnswer,
      trace: {
        sessionsReplayed: 0,
        rememberEvents: [],
        feedbackEvents: [],
        recallHitCount: 0,
        verificationHintCount: 0,
        proposalLifecycle: null,
        maintenanceSummary: null,
        contextBuild: null,
      },
    },
    goodmemory: {
      mode: "goodmemory",
      strategyLabel: "rules-only",
      personaId: "phase27-test-persona",
      scenarioId,
      taskFamily: "preference_continuation",
      targetDomain: "work_ops",
      memorySourceDomains: ["work_ops"],
      evaluationSetting: "single_domain",
      prompt: "What should we continue next?",
      transcript: "user: What should we continue next?",
      memoryContext: "Confirmed from memory:\n- data scientist\n- final verification",
      answer: goodmemoryAnswer,
      trace: {
        sessionsReplayed: 1,
        rememberEvents: [],
        feedbackEvents: [],
        recallHitCount: 1,
        verificationHintCount: 0,
        proposalLifecycle: null,
        maintenanceSummary: null,
        contextBuild: null,
      },
    },
    judge: {
      winner,
      scores: buildJudgeScores(),
      baseline_scores: buildJudgeScores(),
      goodmemory_scores: buildJudgeScores(),
      reasoning: "test",
      failure_tags: [],
      blocking_failure_tags: [],
    },
    assertions: {
      passed: true,
      totalChecks: 1,
      passedChecks: 1,
      checks: [],
      contaminationFindings: [],
      updateFindings: [],
    },
  };
}

describe("run-phase-27 eval script", () => {
  it("resolves the dedicated fallback output directory", () => {
    expect(resolvePhase27FallbackOutputDir("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/eval/fallback/phase-27",
    );
  });

  it("parses phase-27 cli flags", () => {
    expect(
      parsePhase27EvalCliOptions([
        "bun",
        "scripts/run-phase-27-eval.ts",
        "--run-id",
        "phase27-run",
        "--output-dir",
        "/tmp/out",
        "--limit",
        "5",
        "--scenario-id",
        "scenario-medium-13-role-slot",
        "--scenario-id=scenario-medium-13-reference-slot",
      ]),
    ).toEqual({
      limit: 5,
      outputDir: "/tmp/out",
      runId: "phase27-run",
      scenarioIds: [
        "scenario-medium-13-role-slot",
        "scenario-medium-13-reference-slot",
      ],
    });
  });

  it("keeps the deterministic fallback memory rules-only even when provider and vector env vars are present", async () => {
    const originalEnv = { ...process.env };
    process.env.GOODMEMORY_EMBEDDING_PROVIDER = "openai";
    process.env.GOODMEMORY_EMBEDDING_MODEL = "text-embedding-3-small";
    process.env.GOODMEMORY_EMBEDDING_API_KEY = "key";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER = "openai";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_MODEL = "gpt-4o-mini";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY = "key";
    process.env.GOODMEMORY_SQLITE_VECTOR_MODE = "require";
    delete process.env.GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH;

    const createMemory = createPhase27FallbackCreateMemory();
    const handle = createMemory({
      caseId: "phase27-rules-only",
      persona: buildPersonaFixture(),
      scenario: buildScenarioFixture("scenario-medium-13-role-slot"),
      scopeNamespace: "phase27-rules-only",
    });
    const memory = "memory" in handle ? handle.memory : handle;

    try {
      const remember = await memory.remember({
        scope: {
          userId: "phase27-user",
          workspaceId: "phase27-workspace",
          sessionId: "phase27-session",
        },
        extractionStrategy: "auto",
        messages: [
          {
            role: "user",
            content:
              "My name is Noah. I'm a data scientist in Singapore. Remember that the open loop is final verification for workflow reliability dashboard.",
          },
          {
            role: "assistant",
            content: "Noted.",
          },
        ],
      });

      expect(remember.accepted).toBeGreaterThan(0);

      const recall = await memory.recall({
        scope: {
          userId: "phase27-user",
          workspaceId: "phase27-workspace",
          sessionId: "phase27-session",
        },
        query: "What is my role and open loop for workflow reliability dashboard?",
        retrievalProfile: "general_chat",
        strategy: "rules-only",
      });

      expect(recall.profile?.identity.role).toBe("data scientist");
      expect(
        recall.facts.some((fact) =>
          fact.content.includes("open loop is final verification for workflow reliability dashboard"),
        ),
      ).toBeTrue();
    } finally {
      if ("cleanup" in handle && typeof handle.cleanup === "function") {
        await handle.cleanup();
      }
      process.env = originalEnv;
    }
  });

  it("keeps the deterministic baseline on visible transcript context instead of starving it when memoryContext is absent", async () => {
    const visibleScenario = buildVisibleTranscriptScenarioFixture();
    const transcript = [
      "user: Correction: docs/workflow-reliability-dashboard-runbook-v2.md is now the source of truth, not docs/workflow-reliability-dashboard-runbook-v1.md. Please update that.",
      "assistant: Updated. I will use the newer runbook going forward.",
      "user: Please confirm the updated runbook, my role, and the open loop before proposing the next step for workflow reliability dashboard.",
    ].join("\n");
    let baselineAnswer = "";
    let goodmemoryAnswer = "";

    await runPhase27FallbackEval(
      {
        runId: "phase27-visible-context",
        scenarioIds: [visibleScenario.scenario_id],
      },
      {
        ensureDir: async () => undefined,
        loadScenarios: async () => [visibleScenario],
        buildPublicSurfacePurityMetric: async () => ({
          allowedImports: [
            "goodmemory",
            "goodmemory/ai-sdk",
            "goodmemory/host",
            "goodmemory/http",
          ],
          checkedFiles: [],
          checks: [],
          packageBoundarySmoke: "package-name-imports",
          passed: true,
          threshold: "test",
        }),
        buildReferenceSetupMetric: () => ({
          assistedExtractionEnabled: false,
          checks: [],
          createMemoryEntrypoint: "createGoodMemory({})",
          embeddingEnabled: false,
          explicitAdaptersConfigured: false,
          explicitStorageConfigured: false,
          passed: true,
          runtimeStorage: "local-default-sqlite",
          threshold: "test",
        }),
        runCodexHandoffFamily: async () => ({
          cases: [],
          passed: true,
          passedCases: 0,
          requiredCases: 0,
          successRate: 1,
          threshold: "test",
          totalCases: 0,
        }),
        runSuite: async (input) => {
          baselineAnswer = (
            await input.baselineGenerator({
              persona: buildPersonaFixture(),
              scenario: visibleScenario,
              prompt: visibleScenario.evaluation.prompt,
              transcript,
            })
          ).content;
          goodmemoryAnswer = (
            await input.goodmemoryGenerator({
              persona: buildPersonaFixture(),
              scenario: visibleScenario,
              prompt: visibleScenario.evaluation.prompt,
              transcript,
              memoryContext:
                "docs/workflow-reliability-dashboard-runbook-v2.md\nNoah is a data scientist in Singapore.\nOpen loop: final verification for workflow reliability dashboard.",
            })
          ).content;

          return {
            cases: [
              buildCase(
                visibleScenario.scenario_id,
                "goodmemory",
                baselineAnswer,
                goodmemoryAnswer,
              ),
            ],
            mode: "fallback",
            runDirectory: "/tmp/phase27-visible-context/suite",
            runId: input.runId ?? "suite",
            runtime: input.runtime!,
            summary: buildSummary(1),
          };
        },
        writeTextFile: async () => {},
      },
    );

    expect(baselineAnswer).toContain("Visible transcript context:");
    expect(baselineAnswer).toContain(
      "docs/workflow-reliability-dashboard-runbook-v2.md",
    );
    expect(baselineAnswer).not.toContain("missing remembered context");
    expect(goodmemoryAnswer).toContain("Confirmed from memory:");
  });

  it("derives the phase-27 reference setup metric from the shared runtime resolver", () => {
    const metric = buildPhase27ReferenceSetupMetric(process.cwd());

    expect(metric.passed).toBeTrue();
    expect(metric.runtimeStorage).toBe("local-default-sqlite");
    expect(metric.checks.map((check) => check.name)).toEqual([
      "public-default-entrypoint",
      "no-explicit-storage",
      "no-explicit-adapters",
      "local-default-sqlite",
      "rules-only-defaults",
    ]);
    expect(
      metric.checks.find((check) => check.name === "local-default-sqlite")
        ?.details,
    ).toContain(".goodmemory/memory.sqlite");
  });

  it("runs the deterministic phase-27 eval with curated scenarios and thresholded adoption metrics", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const calls: Array<Record<string, unknown>> = [];
    const scenarioIds = [...PHASE_27_FALLBACK_SCENARIO_IDS];
    const scenarios = scenarioIds.map(buildScenarioFixture);
    const cases: JudgedEvalCase[] = [
      ...PHASE_27_IDENTITY_BACKGROUND_SCENARIO_IDS.map((scenarioId, index) =>
        buildCase(
          scenarioId,
          index < 2 ? "goodmemory" : "tie",
          "I need more context before I can answer reliably.",
          "data scientist Singapore final verification",
        )),
      ...PHASE_27_CONTINUATION_OPEN_LOOP_SCENARIO_IDS.map((scenarioId, index) =>
        buildCase(
          scenarioId,
          index < 4 ? "goodmemory" : index === 4 ? "baseline" : "tie",
          "I need more context before I can answer reliably.",
          "final verification",
        )),
      ...PHASE_27_REPEATED_CORRECTION_SCENARIO_IDS.map((scenarioId, index) =>
        buildCase(
          scenarioId,
          index < 3 ? "goodmemory" : "tie",
          "docs/old-runbook.md",
          "docs/current-runbook.md",
        )),
    ];

    const report = await runPhase27FallbackEval(
      {
        outputDir: "/tmp/phase27-fallback",
        runId: "phase27-run",
      },
      {
        ensureDir: async () => undefined,
        loadScenarios: async () => scenarios,
        now: () => "2026-04-21T12:00:00.000Z",
        runCodexHandoffFamily: async () => ({
          cases: [
            { caseId: "handoff-1", details: "passed", passed: true },
            { caseId: "handoff-2", details: "passed", passed: true },
            { caseId: "handoff-3", details: "passed", passed: true },
          ],
          passed: true,
          passedCases: 3,
          requiredCases: 3,
          successRate: 1,
          threshold: "All 3 Codex handoff/resume cases must pass.",
          totalCases: 3,
        }),
        runSuite: async (input) => {
          calls.push({
            createMemory: typeof input.createMemory,
            mode: input.mode,
            outputDir: input.outputDir,
            rememberExtractionStrategy: input.rememberExtractionStrategy,
            runId: input.runId,
            runtime: input.runtime,
            scenarioIds: input.scenarioIds,
            strategies: input.strategies,
          });

          return {
            mode: "fallback",
            runId: input.runId ?? "suite",
            runDirectory: join(String(input.outputDir), String(input.runId ?? "suite")),
            summary: buildSummary(cases.length),
            runtime: input.runtime!,
            cases,
          };
        },
        writeTextFile: async (path, content) => {
          writes.push({ path, content });
        },
      },
    );

    expect(report.summary.accepted).toBeTrue();
    expect(report.metrics.identityBackground.goodmemoryWins).toBe(2);
    expect(report.metrics.continuationOpenLoop.passed).toBeTrue();
    expect(report.metrics.repeatedCorrectionRate.improvement).toBe(1);
    expect(report.metrics.hostHandoffResumeSuccessRate.successRate).toBe(1);
    expect(report.metrics.referenceSetup.passed).toBeTrue();
    expect(report.metrics.referenceSetup.checks.map((check) => check.name)).toEqual([
      "public-default-entrypoint",
      "no-explicit-storage",
      "no-explicit-adapters",
      "local-default-sqlite",
      "rules-only-defaults",
    ]);
    expect(report.metrics.referenceSetup.createMemoryEntrypoint).toBe(
      "createGoodMemory({})",
    );
    expect(report.metrics.referenceSetup.explicitStorageConfigured).toBeFalse();
    expect(report.metrics.referenceSetup.explicitAdaptersConfigured).toBeFalse();
    expect(report.metrics.publicSurfacePurity.passed).toBeTrue();
    expect(report.metrics.publicSurfacePurity.allowedImports).toEqual([
      "goodmemory",
      "goodmemory/ai-sdk",
      "goodmemory/host",
      "goodmemory/http",
    ]);
    expect(calls[0]?.mode).toBe("fallback");
    expect(calls[0]?.runId).toBe("suite");
    expect(calls[0]?.createMemory).toBe("function");
    expect(calls[0]?.scenarioIds).toEqual(scenarioIds);
    expect(calls[0]?.strategies).toEqual(["rules-only"]);
    expect(calls[0]?.rememberExtractionStrategy).toBe("auto");
    expect(calls[0]?.outputDir).toBe(
      "/tmp/phase27-fallback/phase27-run",
    );
    expect((calls[0]?.runtime as { memoryBackend?: string })?.memoryBackend).toBe("sqlite");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe(
      "/tmp/phase27-fallback/phase27-run/report.json",
    );
    expect(writes[0]?.content).toContain("\"accepted\": true");
  });

  it("runs the Codex handoff family through real session artifacts", async () => {
    const summary = await runPhase27CodexHandoffFamily();

    expect(summary.passed).toBeTrue();
    expect(summary.successRate).toBe(1);
    expect(summary.passedCases).toBe(3);
    expect(summary.cases.map((item) => item.caseId)).toEqual([
      "codex-basic-session-handoff",
      "codex-handoff-refresh",
      "codex-active-only-projection",
    ]);
    expect(summary.cases.every((item) => item.details === "passed")).toBeTrue();
  });

  it("resolves the dedicated live-memory output directory", () => {
    expect(resolvePhase27LiveMemoryOutputDir("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/eval/live-memory/phase-27",
    );
  });

  it("parses phase-27 live-memory cli flags", () => {
    expect(
      parsePhase27LiveMemoryCliOptions([
        "bun",
        "scripts/run-phase-27-live-memory.ts",
        "--run-id",
        "phase27-live",
        "--output-dir",
        "/tmp/live",
        "--limit",
        "4",
        "--scenario-id",
        "scenario-medium-13",
        "--scenario-id=scenario-medium-13-reference-slot",
      ]),
    ).toEqual({
      limit: 4,
      outputDir: "/tmp/live",
      runId: "phase27-live",
      scenarioIds: [
        "scenario-medium-13",
        "scenario-medium-13-reference-slot",
      ],
    });
  });

  it("runs the phase-27 live-memory runner with the narrowed live adoption slice", async () => {
    const originalEnv = { ...process.env };
    const writes: Array<{ path: string; content: string }> = [];
    const calls: Array<Record<string, unknown>> = [];
    const providerAssertions: string[] = [];
    const createMemoryCalls: Array<Record<string, unknown>> = [];
    const cleanupCalls: Array<Record<string, unknown>> = [];
    const textGeneratorConfigs: Array<Record<string, unknown>> = [];
    const scenarioIds = [...PHASE_27_LIVE_SCENARIO_IDS];
    const scenarios = scenarioIds.map(buildScenarioFixture);
    const cases: JudgedEvalCase[] = [
      ...PHASE_27_LIVE_CONTINUATION_OPEN_LOOP_SCENARIO_IDS.map((scenarioId) =>
        buildCase(
          scenarioId,
          "goodmemory",
          "I need more context before I can answer reliably.",
          "final verification",
        )),
      ...PHASE_27_LIVE_REPEATED_CORRECTION_SCENARIO_IDS.map((scenarioId, index) =>
        buildCase(
          scenarioId,
          index === 0 ? "goodmemory" : "tie",
          "docs/old-runbook.md",
          "docs/current-runbook.md",
        )),
    ];

    process.env.GOODMEMORY_TEST_POSTGRES_URL = "postgres://example/test";
    process.env.GOODMEMORY_EVAL_PROVIDER = "openai";
    process.env.GOODMEMORY_EVAL_MODEL = "gpt-5.4";
    process.env.GOODMEMORY_EVAL_API_KEY = "key";
    process.env.GOODMEMORY_JUDGE_PROVIDER = "openai";
    process.env.GOODMEMORY_JUDGE_MODEL = "gpt-5.4";
    process.env.GOODMEMORY_JUDGE_API_KEY = "key";
    process.env.GOODMEMORY_EMBEDDING_PROVIDER = "openai";
    process.env.GOODMEMORY_EMBEDDING_MODEL = "text-embedding-3-small";
    process.env.GOODMEMORY_EMBEDDING_API_KEY = "key";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER = "openai";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_MODEL = "gpt-4o-mini";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY = "key";

    try {
      const report = await runPhase27LiveMemoryEval(
        {
          outputDir: "/tmp/phase27-live",
          runId: "phase27-live",
        },
        {
          assertProviderBackedStorage: async (postgresUrl) => {
            providerAssertions.push(postgresUrl);
          },
          createJudgeModel: () => ({
            async complete() {
              return {
                content: JSON.stringify({
                  winner: "goodmemory",
                  scores: buildJudgeScores(),
                  baseline_scores: buildJudgeScores(),
                  goodmemory_scores: buildJudgeScores(),
                  reasoning: "test",
                  failure_tags: [],
                  blocking_failure_tags: [],
                }),
              };
            },
          }),
          createMemory: (config) => {
            createMemoryCalls.push({
              ...(config as unknown as Record<string, unknown>),
              storageProviderEnv: process.env.GOODMEMORY_STORAGE_PROVIDER,
              storageUrlEnv: process.env.GOODMEMORY_STORAGE_URL,
            });

            return {
              jobs: createNoopGoodMemoryJobsFacade(),
              runtime: createNoopGoodMemoryRuntimeFacade(),
              async recall() {
                throw new Error("not used");
              },
              async buildContext() {
                throw new Error("not used");
              },
              async remember() {
                throw new Error("not used");
              },
              async forget() {
                return { forgotten: false };
              },
              async importMemory() {
                throw new Error("importMemory is not implemented by this fake.");
              },
              async exportMemory() {
                throw new Error("not used");
              },
              async deleteAllMemory(input) {
                cleanupCalls.push(input as unknown as Record<string, unknown>);
                return {
                  scope: input.scope,
                  deleted: {
                    profiles: 0,
                    preferences: 0,
                    references: 0,
                    notes: 0,
                    facts: 0,
                    feedback: 0,
                    episodes: 0,
                    archives: 0,
                    evidence: 0,
                    experiences: 0,
                    proposals: 0,
                    promotions: 0,
                    workingMemory: 0,
                    journal: 0,
                    artifactSpills: 0,
                  },
                };
              },
              async feedback() {
                return { accepted: false };
              },
              async reviseMemory() {
                throw new Error("not used");
              },
              async runMaintenance() {
                return {
                  compiledCount: 0,
                  maintenance: null,
                  promotionDecisionCounts: {},
                  proposalCount: 0,
                  ran: false,
                  reason: "threshold" as const,
                };
              },
            };
          },
          createTextGenerator: (config) => {
            textGeneratorConfigs.push(config as unknown as Record<string, unknown>);

            return async () => ({
              content: "final verification",
            });
          },
          ensureDir: async () => undefined,
          loadScenarios: async () => scenarios,
          now: () => "2026-04-21T12:30:00.000Z",
          runSuite: async (input) => {
            const created = input.createMemory?.({
              caseId: "case-phase27-live",
              persona: {
                persona_id: "phase27-test-persona",
                lifecycle_bucket: "medium",
              } as never,
              scenario: scenarios[0]!,
              scopeNamespace: "phase27-live-scope",
            });
            const handle =
              created && "memory" in created ? created : created ? { memory: created } : null;
            await handle?.cleanup?.();

            calls.push({
              createMemory: typeof input.createMemory,
              mode: input.mode,
              outputDir: input.outputDir,
              rememberExtractionStrategy: input.rememberExtractionStrategy,
              runId: input.runId,
              runtime: input.runtime,
              scenarioIds: input.scenarioIds,
              strategies: input.strategies,
            });

            return {
              mode: "live",
              runId: input.runId ?? "suite",
              runDirectory: join(String(input.outputDir), String(input.runId ?? "suite")),
              summary: buildSummary(cases.length, {
                winnerCounts: {
                  baseline: 0,
                  goodmemory: 3,
                  tie: 1,
                },
                strategySummary: {
                  byStrategy: {
                    "rules-only": {
                      totalCases: cases.length,
                      uniqueScenarios: cases.length,
                      winnerCounts: {
                        baseline: 0,
                        goodmemory: 3,
                        tie: 1,
                      },
                      uplift: buildJudgeScores(),
                      regressionCases: [],
                    },
                  },
                  embeddingImpact: null,
                  routerImpact: null,
                },
              }),
              runtime: input.runtime!,
              cases,
            };
          },
          writeTextFile: async (path, content) => {
            writes.push({ path, content });
          },
        },
      );

      expect(report.mode).toBe("live-memory");
      expect(report.summary.accepted).toBeTrue();
      expect(report.metrics.liveWinnerSummary.goodmemoryWins).toBe(3);
      expect(report.metrics.liveWinnerSummary.baselineWins).toBe(0);
      expect(report.metrics.repeatedCorrectionRate.improvement).toBe(1);
      expect(report.metrics.continuationOpenLoop.totalCases).toBe(2);
      expect(calls[0]?.mode).toBe("live");
      expect(calls[0]?.runId).toBe("suite");
      expect(calls[0]?.createMemory).toBe("function");
      expect(calls[0]?.scenarioIds).toEqual(scenarioIds);
      expect(calls[0]?.strategies).toEqual(["rules-only"]);
      expect(calls[0]?.rememberExtractionStrategy).toBe("auto");
      expect(providerAssertions).toEqual(["postgres://example/test"]);
      expect(textGeneratorConfigs).toHaveLength(2);
      expect(textGeneratorConfigs[0]?.system).toBe(textGeneratorConfigs[1]?.system);
      expect(String(textGeneratorConfigs[0]?.system)).not.toContain(
        "visible transcript",
      );
      expect(createMemoryCalls).toEqual([
        {
          storageProviderEnv: "postgres",
          storageUrlEnv: "postgres://example/test",
        },
      ]);
      expect(cleanupCalls).toEqual([
        {
          scope: {
            userId: "phase27-test-persona--eval-phase27-live-scope",
            workspaceId: "eval-medium-phase27-live-scope",
          },
          includeRuntime: true,
        },
      ]);
      expect((calls[0]?.runtime as { memoryBackend?: string })?.memoryBackend).toBe(
        "provider-backed",
      );
      expect(writes).toHaveLength(1);
      expect(writes[0]?.path).toBe(
        "/tmp/phase27-live/phase27-live/report.json",
      );
      expect(writes[0]?.content).toContain("\"mode\": \"live-memory\"");
    } finally {
      process.env = originalEnv;
    }
  });

  it("fails before emitting provider-backed live metadata when postgres is not bootstrap-usable", async () => {
    const originalEnv = { ...process.env };
    let runSuiteCalled = false;

    process.env.GOODMEMORY_TEST_POSTGRES_URL = "postgres://example/test";
    process.env.GOODMEMORY_EVAL_PROVIDER = "openai";
    process.env.GOODMEMORY_EVAL_MODEL = "gpt-5.4";
    process.env.GOODMEMORY_EVAL_API_KEY = "key";
    process.env.GOODMEMORY_JUDGE_PROVIDER = "openai";
    process.env.GOODMEMORY_JUDGE_MODEL = "gpt-5.4";
    process.env.GOODMEMORY_JUDGE_API_KEY = "key";
    process.env.GOODMEMORY_EMBEDDING_PROVIDER = "openai";
    process.env.GOODMEMORY_EMBEDDING_MODEL = "text-embedding-3-small";
    process.env.GOODMEMORY_EMBEDDING_API_KEY = "key";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER = "openai";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_MODEL = "gpt-4o-mini";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY = "key";

    try {
      await expect(
        runPhase27LiveMemoryEval(
          {
            runId: "phase27-live",
          },
          {
            assertProviderBackedStorage: async () => {
              throw new Error("postgres bootstrap probe returned unusable");
            },
            ensureDir: async () => undefined,
            runSuite: async () => {
              runSuiteCalled = true;
              throw new Error("runSuite should not be called");
            },
          },
        ),
      ).rejects.toThrow("postgres bootstrap probe returned unusable");
      expect(runSuiteCalled).toBeFalse();
    } finally {
      process.env = originalEnv;
    }
  });
});
