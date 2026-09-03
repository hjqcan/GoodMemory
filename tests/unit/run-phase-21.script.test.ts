import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  createNoopGoodMemoryJobsFacade,
  createNoopGoodMemoryRuntimeFacade,
} from "../../src/testing/fakes";
import {
  buildPhase21GateCommands,
  buildPhase21GateRunId,
  resolvePhase21GateOutputDir,
  runPhase21QualityGate,
} from "../../scripts/run-phase-21-gate";
import {
  resolvePhase21FallbackOutputDir,
  resolvePhase21FallbackScenarioIds,
  runPhase21FallbackEval,
} from "../../scripts/run-phase-21-eval";
import {
  parsePhase21LiveMemoryCliOptions,
  resolvePhase21LiveMemoryOutputDir,
  runPhase21LiveMemoryCli,
  runPhase21LiveMemoryEval,
} from "../../scripts/run-phase-21-live-memory";

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

function buildEmptyShadowSummary() {
  return {
    totalCases: 0,
    byFamily: {},
    byMode: {},
    candidateInfluencedCases: 0,
    safeObserveCases: 0,
    unknownObserveCases: 0,
    regressionCases: [],
  };
}

describe("run-phase-21 scripts", () => {
  it("resolves phase-21 fallback output and default scenarios", () => {
    expect(resolvePhase21FallbackOutputDir("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/eval/fallback/phase-21",
    );
    expect(resolvePhase21FallbackScenarioIds()).toEqual([
      "scenario-complex-01",
      "scenario-medium-11-blocker-slot-zh",
      "scenario-medium-13-reference-next-step",
      "scenario-medium-13-reference-slot",
      "scenario-medium-13-role-slot",
    ]);
  });

  it("runs phase-21 fallback eval in observe mode with llm-assisted as the candidate strategy", async () => {
    const calls: Array<Record<string, unknown>> = [];

    const report = await runPhase21FallbackEval(
      {
        runId: "run-phase21",
      },
      {
        runSuite: async (input) => {
          calls.push(input as unknown as Record<string, unknown>);
          return {
            mode: "fallback",
            runId: "run-phase21",
            runDirectory: "/tmp/goodmemory/reports/eval/fallback/phase-21/run-phase21",
            summary: buildEmptySuiteSummary(),
            runtime: input.runtime!,
            cases: [],
          };
        },
      },
    );

    expect(report.mode).toBe("fallback");
    expect(calls[0]?.strategies).toEqual(["llm-assisted"]);
    expect(calls[0]?.runtime).toMatchObject({
      memoryBackend: "in-memory",
      embeddingEnabled: true,
      assistedRecallRouterEnabled: true,
    });
    expect(calls[0]?.strategyRollout).toEqual({
      family: "retrieval",
      mode: "observe",
      promotedStrategy: "rules-only",
    });
  });

  it("runs phase-21 live-memory observe and assist with provider-backed recall router metadata", async () => {
    const originalEnv = { ...process.env };
    process.env.GOODMEMORY_TEST_POSTGRES_URL = "postgres://example/test";
    process.env.GOODMEMORY_EVAL_PROVIDER = "openai";
    process.env.GOODMEMORY_EVAL_MODEL = "gpt-4o-mini";
    process.env.GOODMEMORY_EVAL_API_KEY = "key";
    process.env.GOODMEMORY_JUDGE_PROVIDER = "openai";
    process.env.GOODMEMORY_JUDGE_MODEL = "gpt-4o-mini";
    process.env.GOODMEMORY_JUDGE_API_KEY = "key";
    process.env.GOODMEMORY_EMBEDDING_PROVIDER = "openai";
    process.env.GOODMEMORY_EMBEDDING_MODEL = "text-embedding-3-small";
    process.env.GOODMEMORY_EMBEDDING_API_KEY = "key";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER = "openai";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_MODEL = "gpt-4o-mini";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY = "key";
    process.env.GOODMEMORY_RECALL_ROUTER_PROVIDER = "openai";
    process.env.GOODMEMORY_RECALL_ROUTER_MODEL = "gpt-4o-mini";
    process.env.GOODMEMORY_RECALL_ROUTER_API_KEY = "key";

    const runSuiteCalls: Array<Record<string, unknown>> = [];
    const createMemoryCalls: Array<Record<string, unknown>> = [];
    const deleteAllMemoryScopes: Array<Record<string, unknown>> = [];

    try {
      const report = await runPhase21LiveMemoryEval(
        {
          limit: 2,
          outputDir: "/tmp/goodmemory/custom-live-memory/phase-21",
          runId: "run-phase21-live",
          scenarioIds: ["scenario-a", "scenario-a", "scenario-b"],
        },
        {
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
          createMemory: (config, internal) => {
            createMemoryCalls.push({
              config,
              internal,
            });
            return {
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
            };
          },
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
              runDirectory: join("/tmp/goodmemory/reports/eval/live-memory/phase-21", String(input.runId)),
              summary: buildEmptySuiteSummary(),
              runtime: input.runtime!,
              cases: [],
            };
          },
        },
      );

      expect(report.observe.runId).toBe("run-phase21-live-observe");
      expect(report.assist.runId).toBe("run-phase21-live-assist");
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
      ]);
      expect(runSuiteCalls[0]?.limit).toBe(2);
      expect(runSuiteCalls[0]?.scenarioIds).toEqual(["scenario-a", "scenario-b"]);
      expect(runSuiteCalls[0]?.runtime).toMatchObject({
        memoryBackend: "provider-backed",
        embeddingEnabled: true,
        assistedExtractionEnabled: true,
        assistedRecallRouterEnabled: true,
        recallRouterModelId: "gpt-4o-mini",
        recallRouterProviderId: "openai",
      });
      expect(createMemoryCalls[0]?.internal).toMatchObject({
        assistedRecallRouter: expect.any(Object),
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
      ]);
      expect(report.outputDir).toBe("/tmp/goodmemory/custom-live-memory/phase-21");
      expect(resolvePhase21LiveMemoryOutputDir("/tmp/goodmemory")).toBe(
        "/tmp/goodmemory/reports/eval/live-memory/phase-21",
      );
    } finally {
      process.env = originalEnv;
    }
  });

  it("parses phase-21 live-memory cli flags and prints a summarized report", async () => {
    const argv = [
      "bun",
      "run",
      "scripts/run-phase-21-live-memory.ts",
      "--limit",
      "3",
      "--output-dir",
      "/tmp/goodmemory/live-memory/phase-21",
      "--run-id",
      "run-phase21-cli",
      "--scenario-id",
      "scenario-1",
      "--scenario-id",
      "scenario-2",
    ];
    const logs: string[] = [];
    const receivedOptions: Array<Record<string, unknown>> = [];

    expect(parsePhase21LiveMemoryCliOptions(argv)).toEqual({
      limit: 3,
      outputDir: "/tmp/goodmemory/live-memory/phase-21",
      runId: "run-phase21-cli",
      scenarioIds: ["scenario-1", "scenario-2"],
    });

    const report = await runPhase21LiveMemoryCli({
      argv,
      log: (message) => {
        logs.push(message);
      },
      runEval: async (options) => {
        receivedOptions.push((options ?? {}) as Record<string, unknown>);

        return {
          assist: {
            mode: "live",
            runId: "run-phase21-cli-assist",
            runDirectory: "/tmp/goodmemory/live-memory/phase-21/run-phase21-cli-assist",
            summary: buildEmptySuiteSummary(),
            runtime: {
              memoryBackend: "provider-backed",
            } as never,
            cases: [],
          },
          observe: {
            mode: "live",
            runId: "run-phase21-cli-observe",
            runDirectory: "/tmp/goodmemory/live-memory/phase-21/run-phase21-cli-observe",
            summary: {
              ...buildEmptySuiteSummary(),
              shadowSummary: buildEmptyShadowSummary(),
            },
            runtime: {
              memoryBackend: "provider-backed",
            } as never,
            cases: [],
          },
          outputDir: "/tmp/goodmemory/live-memory/phase-21",
        };
      },
    });

    expect(receivedOptions).toEqual([
      {
        limit: 3,
        outputDir: "/tmp/goodmemory/live-memory/phase-21",
        runId: "run-phase21-cli",
        scenarioIds: ["scenario-1", "scenario-2"],
      },
    ]);
    expect(report.assist.runId).toBe("run-phase21-cli-assist");
    expect(report.observe.runId).toBe("run-phase21-cli-observe");
    expect(report.outputDir).toBe("/tmp/goodmemory/live-memory/phase-21");
    expect(JSON.parse(logs[0] ?? "{}")).toEqual({
      assist: {
        runDirectory: "/tmp/goodmemory/live-memory/phase-21/run-phase21-cli-assist",
        runId: "run-phase21-cli-assist",
        summary: {
          totalCases: 0,
        },
      },
      observe: {
        runDirectory: "/tmp/goodmemory/live-memory/phase-21/run-phase21-cli-observe",
        runId: "run-phase21-cli-observe",
        summary: {
          shadowSummary: buildEmptyShadowSummary(),
          totalCases: 0,
        },
      },
      outputDir: "/tmp/goodmemory/live-memory/phase-21",
    });
  });

  it("builds the phase-21 gate command list and accepted report", async () => {
    expect(resolvePhase21GateOutputDir("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/quality-gates/phase-21",
    );
    expect(buildPhase21GateRunId("2026-04-20T10:00:00.000Z")).toBe(
      "run-20260420100000",
    );
    expect(buildPhase21GateCommands("/tmp/goodmemory")).toEqual([
      {
        label: "typecheck",
        cwd: "/tmp/goodmemory",
        args: ["bun", "run", "typecheck"],
      },
      {
        label: "phase-21-targeted-regressions",
        cwd: "/tmp/goodmemory",
        args: [
          "bun",
          "test",
          "tests/unit/recall.assistant.test.ts",
          "tests/unit/provider.layer.test.ts",
          "tests/unit/model-adapters.test.ts",
          "tests/unit/recall.router.test.ts",
          "tests/unit/run-phase-21.script.test.ts",
          "tests/integration/recall.api.test.ts",
        ],
      },
      {
        label: "phase-21-fallback-eval",
        cwd: "/tmp/goodmemory",
        args: ["bun", "run", "eval:phase-21"],
      },
    ]);

    const written: Array<{ path: string; content: string }> = [];
    const report = await runPhase21QualityGate(
      {
        outputDir: "/tmp/goodmemory/reports/quality-gates/phase-21",
        runId: "run-phase21",
      },
      {
        now: () => "2026-04-20T10:00:00.000Z",
        ensureDir: async () => {},
        writeTextFile: async (path, content) => {
          written.push({ path, content });
        },
        runCommand: async () => ({
          exitCode: 0,
          durationMs: 10,
          stdout: "ok\n",
          stderr: "",
        }),
      },
    );

    expect(report.acceptance.decision).toBe("accepted");
    expect(written[0]?.path).toBe(
      join(
        "/tmp/goodmemory/reports/quality-gates/phase-21/run-phase21",
        "phase-21-quality-gate.json",
      ),
    );
  });
});
