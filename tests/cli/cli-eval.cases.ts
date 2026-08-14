import {
  EVIDENCE_COLLECTION,
  HOST_BOOTSTRAP_SCRIPT_TEST_TIMEOUT_MS,
  TEXT_DECODER,
  access,
  aggregateJudgedCases,
  basename,
  buildCase,
  buildWritebackScopeDigest,
  chmod,
  createEvidenceRecord,
  createFactMemory,
  createGoodMemory,
  createMemoryRepositories,
  createMemorySource,
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
  createTempWorkspace,
  describe,
  dirname,
  dropSQLiteTable,
  expect,
  hasSQLiteTable,
  it,
  join,
  mkdir,
  packCurrentPackage,
  persistEvalArtifacts,
  readFile,
  realpath,
  resolveStorageConfig,
  rm,
  runBunScript,
  runCLI,
  seedCodexActionPolicyMemory,
  seedSQLiteMemory,
  withCwd,
  withEnv,
  writeFile,
} from "./cli.test-support";
import type { JudgedEvalCase } from "./cli.test-support";

describe("goodmemory cli eval commands", () => {
  it("eval inspect returns a human-readable case summary", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli");

    try {
      const outputDir = join(workspace.root, "reports");
      const cases: JudgedEvalCase[] = [buildCase("case-1")];
      const summary = aggregateJudgedCases(cases);
      const persisted = await persistEvalArtifacts({
        mode: "fallback",
        outputDir,
        runId: "run-001",
        cases,
        summary,
        runtime: { generationMode: "fallback", judgeMode: "fallback" },
      });

      const result = await runCLI([
        "eval",
        "inspect",
        "--run-dir",
        persisted.runDirectory,
        "--case-id",
        "case-1",
      ]);

      expect(result.stdout).toContain("Run Mode: fallback");
      expect(result.stdout).toContain("Runtime: generation=fallback, judge=fallback");
      expect(result.stdout).toContain("Case: case-1");
      expect(result.stdout).toContain("Task Family: cross_domain_transfer");
      expect(result.stdout).toContain("Target Domain: shopping");
      expect(result.stdout).toContain("Winner: goodmemory");
      expect(result.stdout).toContain("References: 1");
      expect(result.stdout).toContain("Archives: 1");
      expect(result.stdout).toContain("Evidence: 1");
      expect(result.stdout).toContain("Experience Records: 4");
      expect(result.stdout).toContain("Proposals: 2 (accepted=1, delayed=1)");
      expect(result.stdout).toContain("Promotions: 2 (accepted=1, delayed=1)");
      expect(result.stdout).toContain("Assertions: 6/6 passed");
    } finally {
      await workspace.cleanup();
    }
  });

  it("eval trace returns recall and write details", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli");

    try {
      const outputDir = join(workspace.root, "reports");
      const cases: JudgedEvalCase[] = [buildCase("case-1")];
      const summary = aggregateJudgedCases(cases);
      const persisted = await persistEvalArtifacts({
        mode: "fallback",
        outputDir,
        runId: "run-001",
        cases,
        summary,
        runtime: { generationMode: "fallback", judgeMode: "fallback" },
      });

      const result = await runCLI([
        "eval",
        "trace",
        "--run-dir",
        persisted.runDirectory,
        "--case-id",
        "case-1",
      ]);

      expect(result.stdout).toContain("Write Trace");
      expect(result.stdout).toContain("explicit_profile_role");
      expect(result.stdout).toContain("explicit_reference");
      expect(result.stdout).toContain("Recall Hits");
      expect(result.stdout).toContain("semantic_reference");
      expect(result.stdout).toContain("evidence=evidence-1");
      expect(result.stdout).toContain("continuation_context");
      expect(result.stdout).toContain("Router Strategy");
      expect(result.stdout).toContain("rules-only");
      expect(result.stdout).toContain("lexical, runtime, and procedural priors");
      expect(result.stdout).toContain("Policy Applied");
      expect(result.stdout).toContain("custom_shouldRecall");
      expect(result.stdout).toContain("Verification Hints");
      expect(result.stdout).toContain("stale reference should be re-checked before action");
      expect(result.stdout).toContain("Proposal Lifecycle");
      expect(result.stdout).toContain("maintenance_action / accepted");
      expect(result.stdout).toContain("procedural_pattern / delayed");
      expect(result.stdout).toContain("Promotion Decisions");
      expect(result.stdout).toContain("proposal-2 -> delayed");
      expect(result.stdout).toContain("eval=review_required");
      expect(result.stdout).toContain("Assertions");
      expect(result.stdout).toContain("transfer_signals_present: pass");
    } finally {
      await workspace.cleanup();
    }
  });

  it("eval trace tolerates legacy runs without assertions artifacts", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-legacy");

    try {
      const outputDir = join(workspace.root, "reports");
      const cases: JudgedEvalCase[] = [buildCase("case-1")];
      const summary = aggregateJudgedCases(cases);
      const persisted = await persistEvalArtifacts({
        mode: "fallback",
        outputDir,
        runId: "run-001",
        cases,
        summary,
        runtime: { generationMode: "fallback", judgeMode: "fallback" },
      });
      await rm(join(persisted.runDirectory, "traces", "case-1", "assertions.json"));

      const result = await runCLI([
        "eval",
        "trace",
        "--run-dir",
        persisted.runDirectory,
        "--case-id",
        "case-1",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Assertions");
      expect(result.stdout).toContain("unavailable (legacy run)");
    } finally {
      await workspace.cleanup();
    }
  });

  it("eval export-case copies a case artifact to a target path", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli");

    try {
      const outputDir = join(workspace.root, "reports");
      const exportPath = join(workspace.root, "exported-case.json");
      const cases: JudgedEvalCase[] = [buildCase("case-1")];
      const summary = aggregateJudgedCases(cases);
      const persisted = await persistEvalArtifacts({
        mode: "fallback",
        outputDir,
        runId: "run-001",
        cases,
        summary,
        runtime: { generationMode: "fallback", judgeMode: "fallback" },
      });

      const result = await runCLI([
        "eval",
        "export-case",
        "--run-dir",
        persisted.runDirectory,
        "--case-id",
        "case-1",
        "--output",
        exportPath,
      ]);

      const exported = JSON.parse(await readFile(exportPath, "utf8")) as { caseId: string };

      expect(result.stdout).toContain("Exported case artifact");
      expect(exported.caseId).toBe("case-1");
    } finally {
      await workspace.cleanup();
    }
  });
});
