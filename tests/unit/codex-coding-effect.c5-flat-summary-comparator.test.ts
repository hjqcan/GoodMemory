import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertPairedArmIsolation,
  auditFlatSummaryRuntime,
  buildC3CodexArgs,
  buildComparatorArmPlans,
  normalizeC3CodexTreatmentArgs,
} from "../../scripts/codex-coding-effect/c3-arms";
import { prepareC3FlatSummaryArm } from "../../scripts/codex-coding-effect/c3-runtime";
import {
  buildC5FlatSummaryHookConfig,
} from "../../scripts/codex-coding-effect/c5-flat-summary-arm";
import {
  buildC5PilotPlan,
  serializeC5PilotPlan,
  verifyC5PilotPlan,
} from "../../scripts/codex-coding-effect/c5-pilot-plan";
import { loadCodexCodingEffectDataset } from "../../scripts/codex-coding-effect/dataset";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe("Codex coding-effect C5 flat-summary comparator wiring", () => {
  it("allocates an isolated flat-summary baseline arm next to the installed arm", () => {
    const plans = buildComparatorArmPlans({
      baselineArm: "flat-summary",
      episodeId: "episode-001",
      repetition: 1,
      resultRoot: "/tmp/c5/results",
      runId: "c5-run-001",
      runtimeRoot: "/tmp/c5/runtime",
      seed: 7,
      stageId: "stage-2",
      workspaceRoot: "/tmp/c5/workspaces",
    });
    expect(plans.map((plan) => plan.arm)).toEqual([
      "flat-summary",
      "goodmemory-installed",
    ]);
    expect(plans[0]!.paths.packagePrefix).toBeUndefined();
    expect(plans[0]!.paths.injectionRoot).toBe(
      join(plans[0]!.paths.armRoot, "injection"),
    );
    expect(plans[1]!.paths.injectionRoot).toBeUndefined();
    expect(() => assertPairedArmIsolation(plans)).not.toThrow();
    const noMemory = buildComparatorArmPlans({
      baselineArm: "no-memory",
      episodeId: "episode-001",
      repetition: 1,
      resultRoot: "/tmp/c5/results",
      runId: "c5-run-001",
      runtimeRoot: "/tmp/c5/runtime",
      seed: 7,
      stageId: "stage-2",
      workspaceRoot: "/tmp/c5/workspaces",
    });
    expect(noMemory[0]!.arm).toBe("no-memory");
    expect(noMemory[0]!.paths.armRoot).not.toBe(plans[0]!.paths.armRoot);
  });

  it("enables native hooks for the flat-summary arm exactly like the installed arm", () => {
    const args = buildC3CodexArgs({
      arm: "flat-summary",
      model: "gpt-5.6",
      prompt: "task",
      reasoningEffort: "xhigh",
      workspaceRoot: "/tmp/ws",
    });
    expect(args.slice(0, 3)).toEqual([
      "--enable",
      "hooks",
      "--dangerously-bypass-hook-trust",
    ]);
    expect(normalizeC3CodexTreatmentArgs(args)).toEqual(
      normalizeC3CodexTreatmentArgs(buildC3CodexArgs({
        arm: "no-memory",
        model: "gpt-5.6",
        prompt: "task",
        reasoningEffort: "xhigh",
        workspaceRoot: "/tmp/ws",
      })),
    );
  });

  it("materializes a hook-only runtime with no GoodMemory and audits it", async () => {
    const root = await mkdtemp(join(tmpdir(), "c5-flat-summary-runtime-"));
    try {
      const authFile = join(root, "auth.json");
      await writeFile(authFile, "{}\n", "utf8");
      const [plan] = buildComparatorArmPlans({
        baselineArm: "flat-summary",
        episodeId: "episode-001",
        repetition: 1,
        resultRoot: join(root, "results"),
        runId: "c5-run-001",
        runtimeRoot: join(root, "runtime"),
        seed: 7,
        stageId: "stage-2",
        workspaceRoot: join(root, "workspaces"),
      });
      const calls: string[] = [];
      const runtime = await prepareC3FlatSummaryArm({
        authFile,
        bunExecutable: process.execPath,
        codexExecutable: process.execPath,
        plan,
        runProcess: async (request) => {
          calls.push(request.args.join(" "));
          return {
            durationMs: 1,
            exitCode: 0,
            stderr: "",
            stdout: "codex-cli 0.145.0\n",
            timedOut: false,
          };
        },
      });
      expect(calls).toEqual(["--version"]);
      expect(runtime.plan.arm).toBe("flat-summary");
      expect(runtime.codex.version).toBe("codex-cli 0.145.0");
      expect(runtime.env.GOODMEMORY_HOME).toBeUndefined();
      expect(runtime.env.CODEX_HOME).toBe(plan.paths.codexHome);

      const hooksConfig = await readFile(join(plan.paths.codexHome, "hooks.json"), "utf8");
      const runnerPath = join(plan.paths.armRoot, "flat-summary-hook.mjs");
      expect(hooksConfig).toBe(buildC5FlatSummaryHookConfig({ runnerPath }));
      expect(runtime.hookConfig).toEqual({
        path: join(plan.paths.codexHome, "hooks.json"),
        sha256: sha256(hooksConfig),
      });
      const runnerSource = await readFile(runnerPath, "utf8");
      expect(runnerSource).toContain(JSON.stringify(plan.paths.injectionRoot));
      expect(runtime.hookRunnerSha256).toBe(sha256(runnerSource));
      expect((await stat(plan.paths.injectionRoot!)).isDirectory()).toBe(true);

      const config = await readFile(join(plan.paths.codexHome, "config.toml"), "utf8");
      expect(config).toContain("[features]\nhooks = true");
      expect(config).toContain('default_permissions = "c3-task"');
      expect(config).not.toContain("mcp_servers");
      expect(runtime.isolation).toMatchObject({
        goodMemoryFileCount: 0,
        hookConfigPresent: true,
        mcpConfigPresent: false,
        passed: true,
        reasons: [],
      });

      const drifted = await auditFlatSummaryRuntime({
        codexHome: plan.paths.codexHome,
        expectedHookConfigSha256: sha256("other"),
        home: plan.paths.home,
      });
      expect(drifted.passed).toBe(false);
      expect(drifted.reasons).toContain("Codex hooks.json is not the flat-summary hook config");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("freezes a flat-summary comparator plan and keeps the no-memory plan byte-identical", async () => {
    const base = await planInput(73);
    const noMemory = buildC5PilotPlan(base);
    const explicitNoMemory = buildC5PilotPlan({ ...base, baselineArm: "no-memory" });
    expect(serializeC5PilotPlan(explicitNoMemory)).toBe(serializeC5PilotPlan(noMemory));
    expect(noMemory.arms).toEqual(["no-memory", "goodmemory-installed"]);
    expect(noMemory.comparator).toBeUndefined();

    const comparator = buildC5PilotPlan({
      ...base,
      baselineArm: "flat-summary",
      comparator: {
        summaryEndpointSha256: sha256("https://example.invalid/v1/chat/completions"),
        summaryModel: "gpt-5.6",
        summaryPromptSha256: sha256("summarize"),
      },
    });
    expect(comparator.arms).toEqual(["flat-summary", "goodmemory-installed"]);
    expect(comparator.counts).toEqual(noMemory.counts);
    expect(comparator.comparator).toEqual({
      generationPolicy: "once-per-nonempty-stage-history-before-arm-execution",
      injectionCaps: { sessionStart: 1024, userPromptSubmit: 512 },
      noHistoryZeroInjection: true,
      summaryEndpointSha256: sha256("https://example.invalid/v1/chat/completions"),
      summaryModel: "gpt-5.6",
      summaryPromptSha256: sha256("summarize"),
    });
    expect(comparator.clusters.every((cluster) =>
      new Set(cluster.armOrder).size === 2 &&
      cluster.armOrder.includes("flat-summary") &&
      cluster.armOrder.includes("goodmemory-installed")
    )).toBe(true);
    expect(comparator.randomization).toMatchObject({
      baselineFirstClusters: 6,
      goodMemoryFirstClusters: 6,
    });
    expect(comparator.episodeArmRuns.filter((run) => run.arm === "flat-summary")).toHaveLength(12);
    expect(() => verifyC5PilotPlan(comparator, {
      ...base,
      baselineArm: "flat-summary",
      comparator: {
        summaryEndpointSha256: sha256("https://example.invalid/v1/chat/completions"),
        summaryModel: "gpt-5.6",
        summaryPromptSha256: sha256("summarize"),
      },
    })).not.toThrow();
    expect(() => buildC5PilotPlan({ ...base, baselineArm: "flat-summary" })).toThrow(
      "C5 flat-summary baseline requires the comparator summary protocol",
    );
    expect(() => buildC5PilotPlan({
      ...base,
      comparator: {
        summaryEndpointSha256: sha256("x"),
        summaryModel: "gpt-5.6",
        summaryPromptSha256: sha256("summarize"),
      },
    })).toThrow("C5 comparator summary protocol requires the flat-summary baseline");
  });
});

async function planInput(orderSeed: number) {
  const loaded = await loadCodexCodingEffectDataset(
    "fixtures/codex-coding-effect/c4-controlled-pilot",
  );
  return {
    assetLockSha256: "a".repeat(64),
    assetRootSha256: "b".repeat(64),
    baselineCeilingReportSha256: "c".repeat(64),
    c4ReadinessReportSha256: "d".repeat(64),
    dataset: loaded.dataset,
    manifestSha256: "e".repeat(64),
    materialEffectPercentagePoints: 10,
    orderSeed,
  } as const;
}
