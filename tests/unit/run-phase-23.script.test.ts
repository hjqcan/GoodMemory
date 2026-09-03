import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  createPhase23FallbackCreateMemory,
} from "../../src/eval/phase23";
import {
  createNoopGoodMemoryJobsFacade,
  createNoopGoodMemoryRuntimeFacade,
} from "../../src/testing/fakes";
import {
  buildPhase23GateCommands,
  buildPhase23GateRunId,
  parsePhase23GateCliOptions,
  resolvePhase23GateOutputDir,
  runPhase23GateCli,
  runPhase23QualityGate,
} from "../../scripts/run-phase-23-gate";
import {
  resolvePhase23FallbackOutputDir,
  resolvePhase23PromotionScenarioIds,
  runPhase23FallbackEval,
} from "../../scripts/run-phase-23-eval";
import {
  parsePhase23LiveMemoryCliOptions,
  resolvePhase23LiveMemoryOutputDir,
  runPhase23LiveMemoryCli,
  runPhase23LiveMemoryEval,
} from "../../scripts/run-phase-23-live-memory";

function buildEmptySuiteSummary() {
  return {
    totalCases: 0,
    winnerCounts: {
      baseline: 0,
      goodmemory: 0,
      tie: 0,
    },
    baselineAverage: {
      factual_recall: 0,
      preference_consistency: 0,
      cross_domain_transfer: 0,
      contamination_penalty: 0,
      update_correctness: 0,
      personalization_usefulness: 0,
      provenance_explainability: 0,
    },
    goodmemoryAverage: {
      factual_recall: 0,
      preference_consistency: 0,
      cross_domain_transfer: 0,
      contamination_penalty: 0,
      update_correctness: 0,
      personalization_usefulness: 0,
      provenance_explainability: 0,
    },
    uplift: {
      factual_recall: 0,
      preference_consistency: 0,
      cross_domain_transfer: 0,
      contamination_penalty: 0,
      update_correctness: 0,
      personalization_usefulness: 0,
      provenance_explainability: 0,
    },
    layers: {
      baseline: { retrieval: 0, personalization: 0, runtime_governance: 0 },
      goodmemory: { retrieval: 0, personalization: 0, runtime_governance: 0 },
      uplift: { retrieval: 0, personalization: 0, runtime_governance: 0 },
    },
    assertions: {
      totalCases: 0,
      passingCases: 0,
      passRate: 0,
      totalChecks: 0,
      passingChecks: 0,
      checkPassRate: 0,
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
      byStrategy: {},
      embeddingImpact: null,
      routerImpact: null,
    },
  };
}

function buildPromotionAuthorization() {
  return {
    expiresAt: "2026-12-31T00:00:00.000Z",
    family: "retrieval" as const,
    issuedAt: "2026-01-01T00:00:00.000Z",
    pairedObserve: {
      promotionGate: {
        decision: "accepted" as const,
        outcome: "passed" as const,
        promotedStrategyLabel: "rules-only" as const,
        targetStrategyLabel: "llm-assisted" as const,
      },
      source: {
        runId: "observe-run",
      },
      summary: {
        assertionPassRate: 1,
        completedCases: 5,
        executionFailures: 0,
        regressionCases: [],
        safeObserveCases: 5,
        totalCases: 5,
        unknownObserveCases: 0,
      },
    },
    promotionGate: {
      decision: "accepted" as const,
      outcome: "passed" as const,
      promotedStrategyLabel: "rules-only" as const,
      targetStrategyLabel: "llm-assisted" as const,
    },
    publicSurfaceDecision: {
      surfaces: [
        {
          decision: "delayed" as const,
          exposure: "internal" as const,
          surface: "strategy_rollout_config" as const,
        },
        {
          decision: "delayed" as const,
          exposure: "internal" as const,
          surface: "promotion_gate_runtime" as const,
        },
      ],
    },
    regressionDashboardSummary: {
      executionFailureCount: 0,
      totalBlockingCases: 0,
    },
    source: {
      generatedBy: "tests",
      runId: "assist-run",
    },
    targetStrategyLabel: "llm-assisted" as const,
  };
}

describe("run-phase-23 scripts", () => {
  it("resolves phase-23 fallback output and promotion scenarios", () => {
    expect(resolvePhase23FallbackOutputDir("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/eval/fallback/phase-23",
    );
    expect(resolvePhase23PromotionScenarioIds()).toEqual([
      "scenario-medium-13-reference-next-step",
      "scenario-medium-13-blocker-slot",
      "scenario-medium-13-role-slot",
      "scenario-complex-01",
      "scenario-medium-11-reference-slot-zh",
    ]);
  });

  it("runs phase-23 fallback eval through observe, assist, and promote with authorization wiring", async () => {
    const runSuiteCalls: Array<Record<string, unknown>> = [];
    const writes: Array<{ path: string; content: string }> = [];

    const report = await runPhase23FallbackEval(
      {
        runId: "run-phase23",
      },
      {
        createAuthorization: () => buildPromotionAuthorization(),
        writeFileImpl: async (path, content) => {
          writes.push({ path: String(path), content: String(content) });
        },
        runSuite: async (input) => {
          runSuiteCalls.push(input as unknown as Record<string, unknown>);
          return {
            mode: "fallback",
            runId: String(input.runId),
            runDirectory: join(
              "/tmp/goodmemory/reports/eval/fallback/phase-23",
              String(input.runId),
            ),
            summary: buildEmptySuiteSummary(),
            runtime: input.runtime!,
            cases: [],
          };
        },
      },
    );

    expect(report.observe.runId).toBe("run-phase23-observe");
    expect(report.assist.runId).toBe("run-phase23-assist");
    expect(report.promote.runId).toBe("run-phase23-promote");
    expect(runSuiteCalls.map((call) => call.strategyRollout)).toEqual([
      {
        family: "retrieval",
        mode: "observe",
        promotedStrategy: "rules-only",
      },
      {
        family: "retrieval",
        mode: "assist",
        promotedStrategy: "rules-only",
      },
      {
        family: "retrieval",
        mode: "promote",
        promotedStrategy: "llm-assisted",
        promotionAuthorization: buildPromotionAuthorization(),
      },
    ]);
    expect(runSuiteCalls.map((call) => call.strategies)).toEqual([
      ["llm-assisted"],
      ["llm-assisted"],
      ["auto"],
    ]);
    expect(writes[0]?.path).toContain("run-phase23-assist/strategy-promotion-authorization.json");
    expect(resolvePhase23FallbackOutputDir("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/eval/fallback/phase-23",
    );
  });

  it("runs phase-23 live-memory observe, assist, and promote with provider-backed promotion rollout", async () => {
    const originalEnv = { ...process.env };
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
    process.env.GOODMEMORY_RECALL_ROUTER_PROVIDER = "openai";
    process.env.GOODMEMORY_RECALL_ROUTER_MODEL = "gpt-5.4";
    process.env.GOODMEMORY_RECALL_ROUTER_API_KEY = "key";

    const runSuiteCalls: Array<Record<string, unknown>> = [];
    const writes: Array<{ path: string; content: string }> = [];
    const deleteAllMemoryScopes: Array<Record<string, unknown>> = [];

    try {
      const report = await runPhase23LiveMemoryEval(
        {
          limit: 6,
          outputDir: "/tmp/goodmemory/custom-live-memory/phase-23",
          runId: "run-phase23-live",
          scenarioIds: ["scenario-1", "scenario-1", "scenario-2"],
        },
        {
          createAuthorization: () => buildPromotionAuthorization(),
          createTextGenerator: () => async () => ({ content: "answer" }),
          createJudgeModel: () => ({
            async complete() {
              return { content: "{}" };
            },
          }),
          createEmbeddingAdapter: () => ({
            async embed(texts) {
              return texts.map(() => [1, 0, 0]);
            },
          }),
          createMemoryExtractor: () => ({
            async extract() {
              return { candidates: [], ignoredMessageCount: 0 };
            },
          }),
          createRecallRouter: () => ({
            async plan() {
              return {
                querySummary: "refined query",
                rationale: "router plan",
              };
            },
            async rerank() {
              return {
                orderedCandidateIds: ["fact-1"],
                rationale: "router rerank",
              };
            },
          }),
          createMemory: () => ({
            jobs: createNoopGoodMemoryJobsFacade(),
            runtime: createNoopGoodMemoryRuntimeFacade(),
            async buildContext() {
              throw new Error("unused");
            },
            async deleteAllMemory(input) {
              deleteAllMemoryScopes.push(input as unknown as Record<string, unknown>);
              return {
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
                scope: {
                  userId: "u-1",
                },
              };
            },
            async importMemory() {
              throw new Error("importMemory is not implemented by this fake.");
            },
            async exportMemory() {
              throw new Error("unused");
            },
            async feedback() {
              throw new Error("unused");
            },
            async forget() {
              throw new Error("unused");
            },
            async recall() {
              throw new Error("unused");
            },
            async remember() {
              throw new Error("unused");
            },
            async reviseMemory() {
              throw new Error("not used");
            },
            async runMaintenance() {
              throw new Error("unused");
            },
          }),
          runSuite: async (input) => {
            runSuiteCalls.push(input as unknown as Record<string, unknown>);
            const created = input.createMemory?.({
              caseId: "case-1",
              persona: {
                persona_id: "persona-1",
                lifecycle_bucket: "active",
              } as never,
              scenario: {
                scenario_id: "scenario-1",
              } as never,
              scopeNamespace: "scope-1",
              strategyRollout: input.strategyRollout,
            });
            if (created && "cleanup" in created) {
              await created.cleanup?.();
            }
            return {
              mode: "live",
              runId: String(input.runId),
              runDirectory: join(
                "/tmp/goodmemory/reports/eval/live-memory/phase-23",
                String(input.runId),
              ),
              summary: buildEmptySuiteSummary(),
              runtime: input.runtime!,
              cases: [],
            };
          },
          writeFileImpl: async (path, content) => {
            writes.push({ path: String(path), content: String(content) });
          },
        },
      );

      expect(report.observe.runId).toBe("run-phase23-live-observe");
      expect(report.assist.runId).toBe("run-phase23-live-assist");
      expect(report.promote.runId).toBe("run-phase23-live-promote");
      expect(runSuiteCalls.map((call) => call.strategyRollout)).toEqual([
        {
          family: "retrieval",
          mode: "observe",
          promotedStrategy: "rules-only",
        },
        {
          family: "retrieval",
          mode: "assist",
          promotedStrategy: "rules-only",
        },
        {
          family: "retrieval",
          mode: "promote",
          promotedStrategy: "llm-assisted",
          promotionAuthorization: buildPromotionAuthorization(),
        },
      ]);
      expect(runSuiteCalls[0]?.limit).toBe(6);
      expect(runSuiteCalls[0]?.scenarioIds).toEqual(["scenario-1", "scenario-2"]);
      expect(runSuiteCalls.map((call) => call.strategies)).toEqual([
        ["llm-assisted"],
        ["llm-assisted"],
        ["auto"],
      ]);
      expect(runSuiteCalls[2]?.runtime).toMatchObject({
        memoryBackend: "provider-backed",
        embeddingEnabled: true,
        assistedExtractionEnabled: true,
        assistedRecallRouterEnabled: true,
      });
      expect(deleteAllMemoryScopes).toEqual([
        {
          includeRuntime: true,
          scope: {
            userId: "persona-1--eval-scope-1",
            workspaceId: "eval-active-scope-1",
          },
        },
        {
          includeRuntime: true,
          scope: {
            userId: "persona-1--eval-scope-1",
            workspaceId: "eval-active-scope-1",
          },
        },
        {
          includeRuntime: true,
          scope: {
            userId: "persona-1--eval-scope-1",
            workspaceId: "eval-active-scope-1",
          },
        },
      ]);
      expect(writes[0]?.path).toContain(
        "run-phase23-live-assist/strategy-promotion-authorization.json",
      );
      expect(report.outputDir).toBe("/tmp/goodmemory/custom-live-memory/phase-23");
      expect(resolvePhase23LiveMemoryOutputDir("/tmp/goodmemory")).toBe(
        "/tmp/goodmemory/reports/eval/live-memory/phase-23",
      );
    } finally {
      process.env = originalEnv;
    }
  });

  it("parses phase-23 live-memory cli flags and prints a summarized report", async () => {
    const argv = [
      "bun",
      "run",
      "scripts/run-phase-23-live-memory.ts",
      "--limit",
      "7",
      "--output-dir",
      "/tmp/goodmemory/live-memory/phase-23",
      "--run-id",
      "run-phase23-cli",
      "--scenario-id",
      "scenario-1",
      "--scenario-id",
      "scenario-2",
    ];
    const logs: string[] = [];
    const receivedOptions: Array<Record<string, unknown>> = [];

    expect(parsePhase23LiveMemoryCliOptions(argv)).toEqual({
      limit: 7,
      outputDir: "/tmp/goodmemory/live-memory/phase-23",
      runId: "run-phase23-cli",
      scenarioIds: ["scenario-1", "scenario-2"],
    });

    const report = await runPhase23LiveMemoryCli({
      argv,
      log: (message) => {
        logs.push(message);
      },
      runEval: async (options) => {
        receivedOptions.push((options ?? {}) as Record<string, unknown>);

        return {
          assist: {
            mode: "live",
            runId: "run-phase23-cli-assist",
            runDirectory: "/tmp/goodmemory/live-memory/phase-23/run-phase23-cli-assist",
            summary: buildEmptySuiteSummary(),
            runtime: {
              memoryBackend: "provider-backed",
            } as never,
            cases: [],
          },
          authorization: buildPromotionAuthorization(),
          authorizationPath:
            "/tmp/goodmemory/live-memory/phase-23/run-phase23-cli-assist/strategy-promotion-authorization.json",
          observe: {
            mode: "live",
            runId: "run-phase23-cli-observe",
            runDirectory: "/tmp/goodmemory/live-memory/phase-23/run-phase23-cli-observe",
            summary: buildEmptySuiteSummary(),
            runtime: {
              memoryBackend: "provider-backed",
            } as never,
            cases: [],
          },
          outputDir: "/tmp/goodmemory/live-memory/phase-23",
          promote: {
            mode: "live",
            runId: "run-phase23-cli-promote",
            runDirectory: "/tmp/goodmemory/live-memory/phase-23/run-phase23-cli-promote",
            summary: buildEmptySuiteSummary(),
            runtime: {
              memoryBackend: "provider-backed",
            } as never,
            cases: [],
          },
        };
      },
    });

    expect(receivedOptions).toEqual([
      {
        limit: 7,
        outputDir: "/tmp/goodmemory/live-memory/phase-23",
        runId: "run-phase23-cli",
        scenarioIds: ["scenario-1", "scenario-2"],
      },
    ]);
    expect(report.assist.runId).toBe("run-phase23-cli-assist");
    expect(report.observe.runId).toBe("run-phase23-cli-observe");
    expect(report.promote.runId).toBe("run-phase23-cli-promote");
    expect(report.outputDir).toBe("/tmp/goodmemory/live-memory/phase-23");
    expect(JSON.parse(logs[0] ?? "{}")).toEqual({
      authorizationPath:
        "/tmp/goodmemory/live-memory/phase-23/run-phase23-cli-assist/strategy-promotion-authorization.json",
      observe: {
        runDirectory: "/tmp/goodmemory/live-memory/phase-23/run-phase23-cli-observe",
        runId: "run-phase23-cli-observe",
        summary: buildEmptySuiteSummary(),
      },
      assist: {
        runDirectory: "/tmp/goodmemory/live-memory/phase-23/run-phase23-cli-assist",
        runId: "run-phase23-cli-assist",
        summary: buildEmptySuiteSummary(),
      },
      promote: {
        runDirectory: "/tmp/goodmemory/live-memory/phase-23/run-phase23-cli-promote",
        runId: "run-phase23-cli-promote",
        summary: buildEmptySuiteSummary(),
      },
    });
  });

  it("creates a phase-23 fallback memory factory that consumes retrieval promotion rollout", async () => {
    const createMemory = createPhase23FallbackCreateMemory();
    const created = createMemory({
      caseId: "case-1",
      persona: {} as never,
      scenario: {} as never,
      scopeNamespace: "phase23",
      strategyRollout: {
        family: "retrieval",
        mode: "promote",
        promotedStrategy: "llm-assisted",
        promotionAuthorization: buildPromotionAuthorization(),
      },
    });
    const memory = "memory" in created ? created.memory : created;

    const recall = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "Which runbook is the source of truth for the migration rollout?",
      retrievalProfile: "general_chat",
    });

    expect(recall.metadata.routingDecision.strategy).toBe("llm-assisted");
    expect(recall.metadata.routingDecision.strategyExplanation.requestedStrategy).toBe(
      "auto",
    );
  });

  it("builds the phase-23 gate command list and accepted report", async () => {
    expect(resolvePhase23GateOutputDir("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/quality-gates/phase-23",
    );
    expect(buildPhase23GateRunId("2026-04-20T10:00:00.000Z")).toBe(
      "run-20260420100000",
    );
    expect(buildPhase23GateCommands("/tmp/goodmemory").map((item) => item.label)).toEqual([
      "typecheck",
      "phase-23-targeted-regressions",
      "phase-23-fallback-eval",
    ]);
    expect(buildPhase23GateCommands("/tmp/goodmemory")[1]?.args).toEqual([
      "bun",
      "test",
      "tests/unit/eval.strategy-rollout.test.ts",
      "tests/unit/eval.strategy-promotion-gate.test.ts",
      "tests/unit/run-phase-23.script.test.ts",
      "tests/integration/recall.api.test.ts",
      "tests/eval/reporting.test.ts",
      "tests/eval/runners.test.ts",
      "tests/eval/suite.test.ts",
      "tests/release/api-boundary.test.ts",
    ]);

    const report = await runPhase23QualityGate(
      {
        outputDir: "/tmp/goodmemory/reports/quality-gates/phase-23",
        runId: "run-phase23",
      },
      {
        ensureDir: async () => undefined,
        now: () => "2026-04-20T10:00:00.000Z",
        runCommand: async (command) => ({
          durationMs: 5,
          exitCode: 0,
          stderr: "",
          stdout: `${command.label} ok`,
        }),
        writeTextFile: async () => undefined,
      },
    );

    expect(report.acceptance.decision).toBe("accepted");
    expect(report.commands.map((command) => command.status)).toEqual([
      "passed",
      "passed",
      "passed",
    ]);
    expect(report.evidence.fallbackArtifacts).toEqual([
      {
        artifactKind: "ignored_generated",
        ignoredReportPath:
          "reports/eval/fallback/phase-23/run-phase23-observe/report.json",
        regenerateCommand: "bun run eval:phase-23 --run-id run-phase23",
      },
      {
        artifactKind: "ignored_generated",
        ignoredReportPath:
          "reports/eval/fallback/phase-23/run-phase23-assist/report.json",
        regenerateCommand: "bun run eval:phase-23 --run-id run-phase23",
      },
      {
        artifactKind: "ignored_generated",
        ignoredArtifactPath:
          "reports/eval/fallback/phase-23/run-phase23-assist/strategy-promotion-authorization.json",
        regenerateCommand: "bun run eval:phase-23 --run-id run-phase23",
      },
      {
        artifactKind: "ignored_generated",
        ignoredReportPath:
          "reports/eval/fallback/phase-23/run-phase23-promote/report.json",
        regenerateCommand: "bun run eval:phase-23 --run-id run-phase23",
      },
    ]);
  });

  it("parses phase-23 gate cli flags and exits cleanly", async () => {
    expect(
      parsePhase23GateCliOptions([
        "bun",
        "run",
        "scripts/run-phase-23-gate.ts",
        "--output-dir",
        "/tmp/phase23",
        "--run-id",
        "run-phase23",
      ]),
    ).toEqual({
      outputDir: "/tmp/phase23",
      runId: "run-phase23",
    });

    let exitCode = 0;
    const logs: string[] = [];
    const report = await runPhase23GateCli({
      argv: [
        "bun",
        "run",
        "scripts/run-phase-23-gate.ts",
        "--run-id",
        "run-phase23",
      ],
      exit: (code) => {
        exitCode = code;
      },
      log: (message) => {
        logs.push(message);
      },
      runGate: async () => ({
        acceptance: {
          decision: "accepted",
          reason: "ok",
        },
        commands: [],
        evidence: {
          fallbackArtifacts: [],
        },
        generatedAt: "2026-04-20T10:00:00.000Z",
        generatedBy: "tests",
        phase: "phase-23",
        runDirectory: "/tmp/phase23/run-phase23",
        runId: "run-phase23",
        scope: {
          inScope: [],
          outOfScope: [],
        },
      }),
    });

    expect(report.runId).toBe("run-phase23");
    expect(exitCode).toBe(0);
    expect(logs[0]).toContain("\"phase\": \"phase-23\"");
  });
});
