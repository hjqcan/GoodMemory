import { describe, expect, it } from "bun:test";
import {
  buildPhase40GateCommands,
  buildPhase40GateRunId,
  parsePhase40GateCliOptions,
  resolvePhase40GateOutputDir,
  runPhase40GateCli,
  runPhase40QualityGate,
} from "../../scripts/run-phase-40-gate";

const ROOT = "/tmp/goodmemory";
const PHASE39_REPORT_PATH =
  "/tmp/goodmemory/reports/quality-gates/phase-39/run-20260425041112/phase-39-quality-gate.json";
const CROSS_CONSUMER_REPORT_PATH =
  "/tmp/goodmemory/reports/eval/adoption/phase-40/run-20260425163012-cross-consumer/report.json";
const PRODUCT_REPORT_PATH =
  "/tmp/goodmemory/reports/eval/product/phase-40/run-20260425165544-product-eval/report.json";
const PACKAGE_JSON_PATH = "/tmp/goodmemory/package.json";
const PRODUCT_CASE_CONTRACTS = {
  background_remember: {
    expectedSignals: ["background.fact"],
    wrongSignalLabels: ["wrong.background"],
  },
  feedback_procedural_learning: {
    expectedSignals: ["feedback.summary_style"],
    wrongSignalLabels: ["wrong.summary_style"],
  },
  historical_task_continuation: {
    expectedSignals: ["phase40.next_step", "phase40.release_gate"],
    wrongSignalLabels: ["wrong.next_step"],
  },
  identity_background: {
    expectedSignals: ["profile.name", "background.role"],
    wrongSignalLabels: ["wrong.role"],
  },
  open_loop_recall: {
    expectedSignals: ["runtime.open_loop", "runtime.journal_state"],
    wrongSignalLabels: ["wrong.open_loop"],
  },
  user_correction: {
    expectedSignals: ["editor.current"],
    wrongSignalLabels: ["editor.stale"],
  },
} as const;

function productCase(focus: keyof typeof PRODUCT_CASE_CONTRACTS): Record<string, unknown> {
  const contract = PRODUCT_CASE_CONTRACTS[focus];

  return {
    expectedSignals: [...contract.expectedSignals],
    focus,
    goodMemory: {
      matchedSignals: [...contract.expectedSignals],
      missedSignals: [],
      traceId: `${focus}-trace`,
      wrongSignals: [],
    },
    noMemory: {
      matchedSignals: [],
      missedSignals: [...contract.expectedSignals],
      wrongSignals: [],
    },
    passed: true,
    wrongSignalLabels: [...contract.wrongSignalLabels],
  };
}

function acceptedReports(): Record<string, string> {
  return {
    [PACKAGE_JSON_PATH]: JSON.stringify({ version: "0.5.0" }),
    [PHASE39_REPORT_PATH]: JSON.stringify({
      acceptance: { decision: "accepted" },
      runId: "run-20260425041112",
    }),
    [CROSS_CONSUMER_REPORT_PATH]: JSON.stringify({
      acceptance: { decision: "accepted" },
      commands: [
        {
          command: "bun --env-file=/dev/null run examples/basic-chat.ts",
          durationMs: 10,
          exitCode: 0,
          label: "direct-typescript-app",
          status: "passed",
          stderrTail: [],
          stdoutTail: [],
        },
        {
          command: "bun --env-file=/dev/null run examples/express-chat-server.ts",
          durationMs: 10,
          exitCode: 0,
          label: "express-http-server",
          status: "passed",
          stderrTail: [],
          stdoutTail: [],
        },
        {
          command: "bun --env-file=/dev/null run examples/fastify-chat-server.ts",
          durationMs: 10,
          exitCode: 0,
          label: "fastify-http-server",
          status: "passed",
          stderrTail: [],
          stdoutTail: [],
        },
        {
          command:
            "bun --env-file=/dev/null test tests/release/release.test.ts --test-name-pattern installed-package Python bridge smoke covers goodmemory-http-bridge bin and Python consumer",
          durationMs: 10,
          exitCode: 0,
          label: "python-fastapi-bridge-consumer",
          status: "passed",
          stderrTail: [],
          stdoutTail: [],
        },
        {
          command:
            "bun --env-file=/dev/null test tests/release/release.test.ts --test-name-pattern installed-package write CLI smoke covers write -> hook recall -> MCP deep read",
          durationMs: 10,
          exitCode: 0,
          label: "installed-host-package-path",
          status: "passed",
          stderrTail: [],
          stdoutTail: [],
        },
      ],
      evidence: {
        directTypeScriptApp: { status: "accepted" },
        expressHttpServer: { status: "accepted" },
        failureVisibility: { status: "accepted" },
        fastifyHttpServer: { status: "accepted" },
        installedHostPath: { status: "accepted" },
        publicEntrypointsOnly: { status: "accepted" },
        pythonFastApiBridge: { status: "accepted" },
      },
      generatedBy: "scripts/run-phase-40-cross-consumer-smoke.ts",
      mode: "cross-consumer-adoption-smoke",
      phase: "phase-40",
      runId: "run-20260425163012-cross-consumer",
    }),
    [PRODUCT_REPORT_PATH]: JSON.stringify({
      acceptance: { decision: "accepted" },
      cases: [
        productCase("identity_background"),
        productCase("historical_task_continuation"),
        productCase("open_loop_recall"),
        productCase("user_correction"),
        productCase("feedback_procedural_learning"),
        productCase("background_remember"),
      ],
      generatedBy: "scripts/run-phase-40-product-eval.ts",
      metrics: {
        correctness: {
          continuityUplift: 1,
          correctionSuccessRate: 1,
          goodMemoryPassCount: 6,
          missedRecallRate: 0,
          noMemoryPassCount: 0,
          totalCases: 6,
          wrongRecallRate: 0,
        },
        productQuality: {
          backgroundJobFailureVisibility: 1,
          duplicateMemoryRate: 0,
          policyBlockExplainability: 1,
          traceCompletenessRate: 1,
        },
      },
      mode: "product-eval-rollup",
      phase: "phase-40",
      rawTranscriptPersistence: {
        defaultRuntimeArchive: "off",
        persistedRawTranscripts: false,
      },
      runId: "run-20260425165544-product-eval",
      traceEvidence: {
        whyBlocked: { status: "accepted" },
        whyRecalled: { status: "accepted" },
        whyRemembered: { status: "accepted" },
        whyRevised: { status: "accepted" },
      },
      variants: {
        noMemory: { mode: "no-memory" },
        withGoodMemory: { mode: "with-goodmemory" },
      },
    }),
  };
}

function readAcceptedReport(
  reports: Record<string, string>,
): (path: string) => Promise<string> {
  return async (path) => {
    const exact = reports[path];
    if (exact !== undefined) {
      return exact;
    }
    const suffix = Object.keys(reports).find((candidate) =>
      path.endsWith(candidate.replace(`${ROOT}/`, ""))
    );

    return suffix ? reports[suffix]! : "";
  };
}

describe("run-phase-40 gate", () => {
  it("resolves the phase-40 output directory and deterministic run id", () => {
    expect(resolvePhase40GateOutputDir(ROOT)).toBe(
      "/tmp/goodmemory/reports/quality-gates/phase-40",
    );
    expect(buildPhase40GateRunId("2026-04-25T09:15:44.000Z")).toBe(
      "run-20260425091544",
    );
  });

  it("parses phase-40 gate cli flags", () => {
    expect(
      parsePhase40GateCliOptions([
        "bun",
        "run",
        "scripts/run-phase-40-gate.ts",
        "--output-dir",
        "/tmp/phase40-gate",
        "--run-id",
        "run-phase40-gate",
      ]),
    ).toEqual({
      outputDir: "/tmp/phase40-gate",
      runId: "run-phase40-gate",
    });
  });

  it("builds the expected release-candidate regression chain", () => {
    expect(
      buildPhase40GateCommands(ROOT).map((command) => ({
        args: command.args,
        label: command.label,
      })),
    ).toEqual([
      {
        args: [
          "bun",
          "test",
          "tests/unit/run-phase-40.gate.test.ts",
          "tests/unit/run-phase-40.cross-consumer-smoke.test.ts",
          "tests/unit/run-phase-40.product-eval.test.ts",
          "tests/release/release.test.ts",
          "--test-name-pattern",
          "phase-40|package metadata exposes bin, exports, and key scripts|release checklist exists and covers the final gate|release workflow uses manual plus stable tag triggers, gate:phase-40, and tarball artifact upload|ci workflow runs the node package boundary matrix on Node 20, 22, and 24",
        ],
        label: "phase-40-release-regressions",
      },
      {
        args: ["bun", "run", "test:ci"],
        label: "ci-regression-gate",
      },
      {
        args: ["bun", "test", "tests/release/node-package-boundary.test.ts"],
        label: "node-package-boundary-smoke",
      },
      {
        args: [
          "bun",
          "run",
          "eval:phase-40-cross-consumer",
          "--",
          "--run-id",
          "run-20260425163012-cross-consumer",
        ],
        label: "cross-consumer-adoption-smoke",
      },
      {
        args: [
          "bun",
          "run",
          "eval:phase-40-product",
          "--",
          "--run-id",
          "run-20260425165544-product-eval",
        ],
        label: "product-eval-rollup",
      },
      {
        args: ["bun", "pm", "pack", "--dry-run"],
        label: "pack-dry-run",
      },
      {
        args: [
          "bun",
          "run",
          "release:rc-dry-run",
          "--",
          "--output-dir",
          "/tmp/goodmemory/.tmp-goodmemory-phase40/quality-gates/phase-29",
          "--run-id",
          "run-phase40-release-dry-run",
        ],
        label: "release-rc-dry-run",
      },
    ]);
  });

  it("writes an accepted report when all release-candidate evidence passes", async () => {
    const writes: Record<string, string> = {};
    const executedLabels: string[] = [];
    const reports = acceptedReports();
    const report = await runPhase40QualityGate(
      {
        outputDir: "/tmp/phase40-gate",
        runId: "run-phase40-gate",
      },
      {
        ensureDir: async () => {},
        now: () => "2026-04-25T09:15:44.000Z",
        readTextFile: readAcceptedReport(reports),
        runCommand: async (command) => {
          executedLabels.push(command.label);
          return {
            durationMs: 10,
            exitCode: 0,
            stderr: "",
            stdout: "ok",
          };
        },
        writeTextFile: async (path, content) => {
          writes[path] = content;
        },
      },
    );

    expect(report.acceptance.decision).toBe("accepted");
    expect(report.generatedBy).toBe("scripts/run-phase-40-gate.ts");
    expect(report.phase).toBe("phase-40");
    expect(report.releaseCandidate.version).toBe("0.5.0");
    expect(report.evidence.phase39Gate.status).toBe("accepted");
    expect(report.evidence.crossConsumerAdoption.status).toBe("accepted");
    expect(report.evidence.productEval.status).toBe("accepted");
    expect(report.evidence.ciRegression.status).toBe("accepted");
    expect(report.evidence.nodePackageBoundary.status).toBe("accepted");
    expect(report.evidence.externalTarballConsumer.status).toBe("accepted");
    expect(report.evidence.packDryRun.status).toBe("accepted");
    expect(report.evidence.releaseDryRun.status).toBe("accepted");
    expect(report.evidence.releaseChecklistAndStatus.status).toBe("accepted");
    expect(report.evidence.outOfScopeBoundaries.status).toBe("accepted");
    expect(executedLabels).toEqual([
      "phase-40-release-regressions",
      "ci-regression-gate",
      "node-package-boundary-smoke",
      "cross-consumer-adoption-smoke",
      "product-eval-rollup",
      "pack-dry-run",
      "release-rc-dry-run",
    ]);
    expect(Object.keys(writes)).toEqual([
      "/tmp/phase40-gate/run-phase40-gate/phase-40-quality-gate.json",
    ]);
  });

  it("fails closed when cross-consumer evidence is truncated", async () => {
    const reports = acceptedReports();
    const crossConsumer = JSON.parse(reports[CROSS_CONSUMER_REPORT_PATH]!) as {
      evidence: Record<string, unknown>;
    };
    delete crossConsumer.evidence.failureVisibility;
    reports[CROSS_CONSUMER_REPORT_PATH] = JSON.stringify(crossConsumer);

    const report = await runPhase40QualityGate(
      {
        outputDir: "/tmp/phase40-gate",
        runId: "run-phase40-gate",
      },
      {
        ensureDir: async () => {},
        now: () => "2026-04-25T09:15:44.000Z",
        readTextFile: readAcceptedReport(reports),
        runCommand: async () => ({
          durationMs: 10,
          exitCode: 0,
          stderr: "",
          stdout: "ok",
        }),
        writeTextFile: async () => {},
      },
    );

    expect(report.acceptance.decision).toBe("blocked");
    expect(report.evidence.crossConsumerAdoption.status).toBe("blocked");
  });

  it("fails closed when product eval cases are truncated", async () => {
    const reports = acceptedReports();
    const product = JSON.parse(reports[PRODUCT_REPORT_PATH]!) as {
      cases?: unknown[];
    };
    delete product.cases;
    reports[PRODUCT_REPORT_PATH] = JSON.stringify(product);

    const report = await runPhase40QualityGate(
      {
        outputDir: "/tmp/phase40-gate",
        runId: "run-phase40-gate",
      },
      {
        ensureDir: async () => {},
        now: () => "2026-04-25T09:15:44.000Z",
        readTextFile: readAcceptedReport(reports),
        runCommand: async () => ({
          durationMs: 10,
          exitCode: 0,
          stderr: "",
          stdout: "ok",
        }),
        writeTextFile: async () => {},
      },
    );

    expect(report.acceptance.decision).toBe("blocked");
    expect(report.evidence.productEval.status).toBe("blocked");
  });

  it("fails closed when a cross-consumer command is substituted", async () => {
    const reports = acceptedReports();
    const crossConsumer = JSON.parse(reports[CROSS_CONSUMER_REPORT_PATH]!) as {
      commands: Array<{ command: string; label: string }>;
    };
    crossConsumer.commands[1]!.command = "bun --version";
    reports[CROSS_CONSUMER_REPORT_PATH] = JSON.stringify(crossConsumer);

    const report = await runPhase40QualityGate(
      {
        outputDir: "/tmp/phase40-gate",
        runId: "run-phase40-gate",
      },
      {
        ensureDir: async () => {},
        now: () => "2026-04-25T09:15:44.000Z",
        readTextFile: readAcceptedReport(reports),
        runCommand: async () => ({
          durationMs: 10,
          exitCode: 0,
          stderr: "",
          stdout: "ok",
        }),
        writeTextFile: async () => {},
      },
    );

    expect(report.acceptance.decision).toBe("blocked");
    expect(report.evidence.crossConsumerAdoption.status).toBe("blocked");
  });

  it("fails closed when a product case drops a required signal", async () => {
    const reports = acceptedReports();
    const product = JSON.parse(reports[PRODUCT_REPORT_PATH]!) as {
      cases: Array<{
        expectedSignals: string[];
        goodMemory: { matchedSignals: string[] };
        noMemory: { missedSignals: string[] };
      }>;
    };
    const identity = product.cases[0]!;
    identity.expectedSignals = ["profile.name"];
    identity.goodMemory.matchedSignals = ["profile.name"];
    identity.noMemory.missedSignals = ["profile.name"];
    reports[PRODUCT_REPORT_PATH] = JSON.stringify(product);

    const report = await runPhase40QualityGate(
      {
        outputDir: "/tmp/phase40-gate",
        runId: "run-phase40-gate",
      },
      {
        ensureDir: async () => {},
        now: () => "2026-04-25T09:15:44.000Z",
        readTextFile: readAcceptedReport(reports),
        runCommand: async () => ({
          durationMs: 10,
          exitCode: 0,
          stderr: "",
          stdout: "ok",
        }),
        writeTextFile: async () => {},
      },
    );

    expect(report.acceptance.decision).toBe("blocked");
    expect(report.evidence.productEval.status).toBe("blocked");
  });

  it("fails closed when a required release-candidate command fails", async () => {
    const writes: Record<string, string> = {};
    const report = await runPhase40QualityGate(
      {
        outputDir: "/tmp/phase40-gate",
        runId: "run-phase40-gate",
      },
      {
        ensureDir: async () => {},
        now: () => "2026-04-25T09:15:44.000Z",
        readTextFile: readAcceptedReport(acceptedReports()),
        runCommand: async (command) => ({
          durationMs: 5,
          exitCode: command.label === "ci-regression-gate" ? 1 : 0,
          stderr: "failed",
          stdout: "",
        }),
        writeTextFile: async (path, content) => {
          writes[path] = content;
        },
      },
    );

    expect(report.acceptance).toEqual({
      decision: "blocked",
      reason: "Required Phase 40 command failed: ci-regression-gate.",
    });
    expect(report.commands.map((command) => command.label)).toEqual([
      "phase-40-release-regressions",
      "ci-regression-gate",
    ]);
    expect(report.evidence.ciRegression.status).toBe("blocked");
    expect(Object.keys(writes)).toEqual([
      "/tmp/phase40-gate/run-phase40-gate/phase-40-quality-gate.json",
    ]);
  });

  it("runs the cli wrapper and forwards blocked exit codes", async () => {
    const exits: number[] = [];
    const logs: string[] = [];
    const report = await runPhase40GateCli({
      argv: [
        "bun",
        "run",
        "scripts/run-phase-40-gate.ts",
        "--output-dir",
        "/tmp/phase40-gate",
      ],
      exit: (code) => {
        exits.push(code);
      },
      log: (message) => {
        logs.push(message);
      },
      runGate: async () => ({
        acceptance: {
          decision: "blocked",
          reason: "blocked for test",
        },
        commands: [
          {
            command: "bun run test:ci",
            durationMs: 25,
            exitCode: 1,
            label: "ci-regression-gate",
            status: "failed",
            stderrTail: ["one failing test"],
            stdoutTail: ["test output"],
          },
        ],
        evidence: {
          ciRegression: { reason: "not run", status: "blocked" },
          crossConsumerAdoption: { reason: "not run", status: "blocked" },
          externalTarballConsumer: { reason: "not run", status: "blocked" },
          nodePackageBoundary: { reason: "not run", status: "blocked" },
          outOfScopeBoundaries: { reason: "not run", status: "blocked" },
          packDryRun: { reason: "not run", status: "blocked" },
          phase39Gate: { reason: "not run", status: "blocked" },
          productEval: { reason: "not run", status: "blocked" },
          releaseChecklistAndStatus: { reason: "not run", status: "blocked" },
          releaseDryRun: { reason: "not run", status: "blocked" },
        },
        generatedAt: "2026-04-25T09:15:44.000Z",
        generatedBy: "scripts/run-phase-40-gate.ts",
        phase: "phase-40",
        releaseCandidate: {
          evidencePaths: [],
          version: "0.2.5",
        },
        runDirectory: "/tmp/phase40-gate/run-phase40-gate",
        runId: "run-phase40-gate",
        scope: {
          inScope: [],
          outOfScope: [],
        },
      }),
    });

    expect(report.acceptance.decision).toBe("blocked");
    expect(exits).toEqual([1]);
    expect(logs[0]).toContain("Phase 40 quality gate blocked");
    expect(logs).toContain("Failed command: ci-regression-gate");
    expect(logs).toContain("Command: bun run test:ci");
    expect(logs).toContain("stdout tail:");
    expect(logs).toContain("test output");
    expect(logs).toContain("stderr tail:");
    expect(logs).toContain("one failing test");
  });
});
