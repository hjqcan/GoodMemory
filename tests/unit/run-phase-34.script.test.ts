import { describe, expect, it } from "bun:test";
import {
  buildPhase34FallbackRunId,
  parsePhase34EvalCliOptions,
  resolvePhase34FallbackOutputDir,
  runPhase34FallbackEval,
} from "../../scripts/run-phase-34-eval";

describe("run-phase-34 eval script", () => {
  it("resolves the phase-34 deterministic output directory", () => {
    expect(resolvePhase34FallbackOutputDir("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/eval/fallback/phase-34",
    );
  });

  it("builds a deterministic phase-34 run id", () => {
    expect(buildPhase34FallbackRunId("2026-04-22T21:30:45.000Z")).toBe(
      "run-20260422213045",
    );
  });

  it("parses phase-34 eval cli flags", () => {
    expect(
      parsePhase34EvalCliOptions([
        "bun",
        "run",
        "scripts/run-phase-34-eval.ts",
        "--output-dir",
        "/tmp/phase34",
        "--run-id",
        "run-phase34",
      ]),
    ).toEqual({
      outputDir: "/tmp/phase34",
      runId: "run-phase34",
    });
  });

  it("writes a deterministic pre-action report with soft-guard and no-memory baselines", async () => {
    const writes: Array<{ content: string; path: string }> = [];
    const directories: string[] = [];

    const report = await runPhase34FallbackEval(
      {
        outputDir: "/tmp/goodmemory/reports/eval/fallback/phase-34",
        runId: "run-phase34",
      },
      {
        ensureDir: async (path) => {
          directories.push(path);
        },
        now: () => "2026-04-22T21:30:45.000Z",
        writeTextFile: async (path, content) => {
          writes.push({ path, content });
        },
      },
    );

    expect(report.phase).toBe("phase-34");
    expect(report.mode).toBe("fallback");
    expect(report.runId).toBe("run-phase34");
    expect(report.acceptance.decision).toBe("accepted");
    expect(report.summary.totalCases).toBe(3);
    expect(report.summary.highRiskCaseCount).toBe(2);
    expect(report.summary.lowRiskCaseCount).toBe(1);
    expect(report.summary.firstActionInterceptionCount).toBe(2);
    expect(report.summary.correctedFirstStepCount).toBe(2);
    expect(report.summary.falseBlockCount).toBe(0);
    expect(report.summary.completionNonRegressionPassCount).toBe(3);
    expect(report.summary.phase32SoftGuardReminderCount).toBe(3);
    expect(report.summary.noMemoryReminderCount).toBe(0);
    expect(
      report.cases.find((caseResult) => caseResult.caseId === "deploy-rewrite")
        ?.policyBacked,
    ).toEqual({
      blocked: false,
      decision: "review_required",
      effectiveFirstStep: "Before deploy, run smoke verification.",
      executeOriginalActionNow: false,
      intercepted: true,
      matchedEvidenceIds: ["evidence-deploy-1"],
      matchedMemoryIds: ["feedback-evidence-deploy-1"],
      realizedEventParentId: "phase34-deploy-rewrite-action",
      rewritten: true,
    });
    expect(
      report.cases.find((caseResult) => caseResult.caseId === "protected-delete-veto")
        ?.policyBacked.decision,
    ).toBe("blocked");
    expect(
      report.cases.find((caseResult) => caseResult.caseId === "protected-delete-veto")
        ?.phase32SoftGuard.context,
    ).toContain("Never delete AGENTS.md from the host bootstrap surface.");
    expect(
      report.cases.find((caseResult) => caseResult.caseId === "low-risk-guidance")
        ?.policyBacked.decision,
    ).toBe("allow_with_guidance");
    expect(
      report.cases.find((caseResult) => caseResult.caseId === "low-risk-guidance")
        ?.policyBacked.executeOriginalActionNow,
    ).toBe(true);
    expect(
      report.cases.find((caseResult) => caseResult.caseId === "low-risk-guidance")
        ?.phase32SoftGuard.context,
    ).toContain("Close the Phase 34 package smoke path");
    expect(
      report.cases.every((caseResult) => caseResult.noMemory.context.trim().length === 0),
    ).toBe(true);
    expect(directories).toEqual([
      "/tmp/goodmemory/reports/eval/fallback/phase-34/run-phase34",
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe(
      "/tmp/goodmemory/reports/eval/fallback/phase-34/run-phase34/report.json",
    );
    expect(JSON.parse(writes[0]!.content)).toEqual(report);
  });

  it("stays rules-only even when recall-router and extractor env vars are set", async () => {
    const previousEnv = {
      GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY:
        process.env.GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY,
      GOODMEMORY_ASSISTED_EXTRACTOR_MODEL:
        process.env.GOODMEMORY_ASSISTED_EXTRACTOR_MODEL,
      GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER:
        process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER,
      GOODMEMORY_EMBEDDING_API_KEY: process.env.GOODMEMORY_EMBEDDING_API_KEY,
      GOODMEMORY_EMBEDDING_MODEL: process.env.GOODMEMORY_EMBEDDING_MODEL,
      GOODMEMORY_EMBEDDING_PROVIDER: process.env.GOODMEMORY_EMBEDDING_PROVIDER,
      GOODMEMORY_RECALL_ROUTER_API_KEY: process.env.GOODMEMORY_RECALL_ROUTER_API_KEY,
      GOODMEMORY_RECALL_ROUTER_MODEL: process.env.GOODMEMORY_RECALL_ROUTER_MODEL,
      GOODMEMORY_RECALL_ROUTER_PROVIDER:
        process.env.GOODMEMORY_RECALL_ROUTER_PROVIDER,
    };

    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER = "openai";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_MODEL = "openai/gpt-4o-mini";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY = "extractor-key";
    process.env.GOODMEMORY_EMBEDDING_PROVIDER = "openai";
    process.env.GOODMEMORY_EMBEDDING_MODEL = "openai/text-embedding-3-small";
    process.env.GOODMEMORY_EMBEDDING_API_KEY = "embedding-key";
    process.env.GOODMEMORY_RECALL_ROUTER_PROVIDER = "openai";
    process.env.GOODMEMORY_RECALL_ROUTER_MODEL = "openai/gpt-4o-mini";
    process.env.GOODMEMORY_RECALL_ROUTER_API_KEY = "router-key";

    try {
      const report = await runPhase34FallbackEval(
        {
          outputDir: "/tmp/goodmemory/reports/eval/fallback/phase-34",
          runId: "run-phase34-rules-only",
        },
        {
          ensureDir: async () => {},
          now: () => "2026-04-22T21:30:45.000Z",
          writeTextFile: async () => {},
        },
      );

      expect(report.acceptance.decision).toBe("accepted");
      expect(process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER).toBe("openai");
      expect(process.env.GOODMEMORY_EMBEDDING_PROVIDER).toBe("openai");
      expect(process.env.GOODMEMORY_RECALL_ROUTER_PROVIDER).toBe("openai");
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
