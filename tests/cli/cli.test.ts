import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { access, chmod, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { buildWritebackScopeDigest } from "../../src/install/hostWritebackAuditLedger";
import {
  createFactMemory,
  createFeedbackMemory,
  createGoodMemory,
  createReferenceMemory,
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
  createUserProfile,
} from "../../src";
import { createMemorySource } from "../../src/domain/provenance";
import {
  createEvidenceRecord,
  EVIDENCE_COLLECTION,
} from "../../src/evidence/contracts";
import { createSessionArchive } from "../../src/evolution/contracts";
import type { EvalAssertionSummary } from "../../src/eval/assertions";
import type { JudgedEvalCase } from "../../src/eval/contracts";
import type { JudgeResult } from "../../src/eval/judge";
import {
  aggregateJudgedCases,
  persistEvalArtifacts,
} from "../../src/eval/reporting";
import type { EvalAnswerPackage } from "../../src/eval/runners";
import { createInMemoryVectorStore } from "../../src/storage/memory";
import { createMemoryRepositories } from "../../src/storage/repositories";
import { createTempWorkspace } from "../../src/testing/utils";
import { resolveStorageConfig, runCLI } from "../../src/cli";
import { withPackagePackLock } from "../support/package-pack-lock";

const TEXT_DECODER = new TextDecoder();
const HOST_BOOTSTRAP_SCRIPT_TEST_TIMEOUT_MS = 60_000;

async function withCwd<T>(cwd: string, callback: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await callback();
  } finally {
    process.chdir(previous);
  }
}

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function runBunScript(input: {
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  scriptPath: string;
  stdin?: string;
}): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  const stdin = input.stdin;
  const childProcess = Bun.spawn({
    cmd: ["bun", input.scriptPath, ...(input.args ?? [])],
    cwd: input.cwd,
    env: {
      ...process.env,
      ...(input.env ?? {}),
    },
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdin !== undefined) {
    if (!childProcess.stdin) {
      throw new Error("bun test helper expected a writable stdin pipe");
    }
    childProcess.stdin.write(stdin);
    childProcess.stdin.end();
  }
  const stdout = await new Response(childProcess.stdout).text();
  const stderr = await new Response(childProcess.stderr).text();
  const exitCode = await childProcess.exited;

  return {
    exitCode,
    stderr,
    stdout,
  };
}

async function packCurrentPackage(input: {
  outputDir: string;
  packageRoot: string;
}): Promise<string> {
  await rm(input.outputDir, { force: true, recursive: true });
  await mkdir(input.outputDir, { recursive: true });

  const pack = await withPackagePackLock(input.packageRoot, () =>
    Bun.spawnSync({
      cmd: ["bun", "pm", "pack", "--destination", input.outputDir, "--quiet"],
      cwd: input.packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    }),
  );
  if (pack.exitCode !== 0) {
    throw new Error(
      [
        "Failed to pack the current GoodMemory package for an installed-package CLI test.",
        TEXT_DECODER.decode(pack.stderr).trim(),
      ]
        .filter((line) => line.length > 0)
        .join("\n"),
    );
  }

  const stdout = TEXT_DECODER.decode(pack.stdout).trim();
  const tarballOutput = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".tgz"))
    .at(-1);
  if (tarballOutput === undefined) {
    throw new Error("Expected bun pm pack to print the generated tarball path.");
  }

  return tarballOutput.includes("/")
    ? tarballOutput
    : join(input.outputDir, tarballOutput);
}

function buildAnswerPackage(
  caseId: string,
  mode: "baseline" | "goodmemory",
): EvalAnswerPackage {
  const source = createMemorySource({
    method: "explicit",
    extractedAt: "2026-01-01T00:00:00.000Z",
    sessionId: "s-0",
  });

  return {
    mode,
    strategyLabel: mode === "goodmemory" ? "rules-only" : "baseline",
    resolvedStrategyLabel: mode === "goodmemory" ? "rules-only" : undefined,
    personaId: caseId,
    scenarioId: `scenario-${caseId}`,
    taskFamily: "cross_domain_transfer",
    targetDomain: "shopping",
    memorySourceDomains: ["work_ops", "gaming"],
    evaluationSetting: "cross_domain",
    prompt: "Prompt",
    transcript: "Transcript",
    answer: mode === "goodmemory" ? "goodmemory-answer" : "baseline-answer",
    memoryContext: mode === "goodmemory" ? "## References\n- Runbook" : undefined,
    retrieved:
      mode === "goodmemory"
        ? {
            profile: null,
            preferences: [],
            references: [
              {
                id: "ref-1",
                userId: caseId,
                title: "Runbook",
                pointer: "docs/runbook.md",
                confidence: 1,
                source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
                lifecycle: "active",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
            facts: [],
            feedback: [],
            archives: [
              createSessionArchive({
                id: "archive-1",
                userId: caseId,
                sessionId: "s-0",
                summary: "Previous session paused at final verification.",
                createdAt: "2026-01-01T00:00:00.000Z",
                archivedAt: "2026-01-01T00:00:00.000Z",
              }),
            ],
            evidence: [
              createEvidenceRecord({
                id: "evidence-1",
                userId: caseId,
                sessionId: "s-0",
                kind: "conversation_excerpt",
                excerpt: "The user said docs/runbook.md is the source of truth.",
                source,
                linkedMemoryIds: ["ref-1"],
              }),
            ],
            episodes: [],
            workingMemory: null,
            journal: null,
            routingDecision: {
              retrievalProfile: "coding_agent",
              intent: "task_continuation",
              strategy: "rules-only",
              strategyExplanation: {
                requestedStrategy: "rules-only",
                resolvedStrategy: "rules-only",
                summary:
                  "rules-only default keeps lexical, runtime, and procedural priors as the hard floor.",
                hardFloor: "lexical_runtime_procedural_priors",
                semanticTieBreaking: false,
                llmRefinement: false,
              },
              sourcePriorities: [
                "working_memory",
                "session_journal",
                "session_archive",
                "episode",
                "fact",
                "evidence",
                "feedback",
                "profile",
              ],
              requestedSlots: ["reference"],
              supportSlots: ["runtime_continuity"],
              actionDriving: false,
              referenceSeeking: true,
              continuation: true,
            },
            hits: [
              {
                id: "ref-1",
                type: "reference",
                reason: "semantic_reference",
                sourceMethod: "explicit",
                evidenceIds: ["evidence-1"],
              },
              {
                id: "archive-1",
                type: "session_archive",
                reason: "continuation_context",
              },
            ],
            candidateTraces: [
              {
                memoryId: "ref-1",
                memoryType: "reference",
                slot: "reference",
                returned: true,
                whyReturned:
                  "slot=reference, intentScore=1.00, lexicalScore=0.86, fallback=none",
                intentScore: 1,
                lexicalScore: 0.86,
                freshnessScore: 1,
                explicitnessScore: 1,
                fallback: "none",
              },
            ],
            policyApplied: ["custom_shouldRecall"],
            verificationHints: [
              {
                memoryId: "ref-1",
                memoryType: "reference",
                reason: "stale reference should be re-checked before action",
                evidenceIds: ["evidence-1"],
              },
            ],
            renderedMemoryContext: "## References\n- Runbook",
          }
        : undefined,
    trace: {
      sessionsReplayed: mode === "goodmemory" ? 2 : 0,
      rememberEvents:
        mode === "goodmemory"
          ? [
              {
                sessionId: "s-1",
                replayedTurns: 2,
                accepted: 1,
                rejected: 0,
                events: [
                  {
                    candidateId: "candidate-0",
                    outcome: "written",
                    memoryType: "profile",
                    memoryId: caseId,
                    reason: "explicit_profile_role",
                    sourceMethod: "explicit",
                  },
                  {
                    candidateId: "candidate-1",
                    outcome: "written",
                    memoryType: "reference",
                    memoryId: "ref-1",
                    reason: "explicit_reference",
                    sourceMethod: "explicit",
                  },
                ],
              },
            ]
          : [],
      feedbackEvents: [],
      recallHitCount: mode === "goodmemory" ? 1 : 0,
      verificationHintCount: 0,
      proposalLifecycle:
        mode === "goodmemory"
          ? {
              experienceCount: 4,
              experienceKindCounts: {
                remember: 1,
                feedback: 2,
                verify: 1,
              },
              proposalCount: 2,
              proposalStatusCounts: {
                accepted: 1,
                delayed: 1,
              },
              promotionCount: 2,
              promotionDecisionCounts: {
                accepted: 1,
                delayed: 1,
              },
              proposals: [
                {
                  id: "proposal-1",
                  proposalType: "maintenance_action" as const,
                  status: "accepted" as const,
                  summary: "Re-check stale blocker memory.",
                  rationale: "One verification trace suggests a bounded maintenance follow-up.",
                  modelInfluence: "rules-only" as const,
                  sourceExperienceIds: ["xp-1"],
                  linkedMemoryIds: ["fact-1"],
                  linkedArchiveIds: [],
                  linkedEvidenceIds: ["evidence-1"],
                },
                {
                  id: "proposal-2",
                  proposalType: "procedural_pattern" as const,
                  status: "delayed" as const,
                  summary: "Promote repeated guidance into a pattern.",
                  rationale: "Repeated feedback suggests a reusable pattern.",
                  modelInfluence: "rules-only" as const,
                  sourceExperienceIds: ["xp-2", "xp-3"],
                  linkedMemoryIds: ["feedback-1"],
                  linkedArchiveIds: [],
                  linkedEvidenceIds: [],
                },
              ],
              promotions: [
                {
                  id: "promotion-1",
                  proposalId: "proposal-1",
                  decision: "accepted" as const,
                  summary: "accepted proposal: Re-check stale blocker memory.",
                  rationale: "proposal passed deterministic gates",
                  policyOutcome: "passed" as const,
                  verificationOutcome: "passed" as const,
                  evalOutcome: "passed" as const,
                },
                {
                  id: "promotion-2",
                  proposalId: "proposal-2",
                  decision: "delayed" as const,
                  summary: "delayed proposal: Promote repeated guidance into a pattern.",
                  rationale: "procedural proposal requires later eval review",
                  policyOutcome: "passed" as const,
                  verificationOutcome: "passed" as const,
                  evalOutcome: "review_required" as const,
                },
              ],
            }
          : null,
      contextBuild:
        mode === "goodmemory"
          ? {
              output: "markdown",
              maxTokens: 160,
              contentLength: 22,
              contextEstimatedTokens: 6,
              packetTokenCountBeforeRender: 12,
            }
          : null,
    },
  };
}

function buildJudgeResult(): JudgeResult {
  return {
    winner: "goodmemory",
    scores: {
      factual_recall: 8,
      preference_consistency: 9,
      cross_domain_transfer: 8,
      contamination_penalty: 9,
      update_correctness: 8,
      personalization_usefulness: 9,
      provenance_explainability: 8,
    },
    baseline_scores: {
      factual_recall: 5,
      preference_consistency: 4,
      cross_domain_transfer: 4,
      contamination_penalty: 5,
      update_correctness: 4,
      personalization_usefulness: 4,
      provenance_explainability: 5,
    },
    goodmemory_scores: {
      factual_recall: 8,
      preference_consistency: 9,
      cross_domain_transfer: 8,
      contamination_penalty: 9,
      update_correctness: 8,
      personalization_usefulness: 9,
      provenance_explainability: 8,
    },
    reasoning: "comparison complete",
    failure_tags: [],
  };
}

function buildAssertions(): EvalAssertionSummary {
  return {
    passed: true,
    totalChecks: 6,
    passedChecks: 6,
    checks: [
      { id: "transfer_signals_present", passed: true, details: ["present:risk-first summaries"] },
      { id: "non_transfer_signals_absent", passed: true, details: ["absent:spoiler-heavy framing"] },
      { id: "update_wins_present", passed: true, details: ["present:docs/runbook.md"] },
      { id: "stale_suppression_absent", passed: true, details: ["absent:docs/stale-runbook.md"] },
      { id: "wrong_personalization_absent", passed: true, details: ["absent:spoiler-heavy framing"] },
      { id: "provenance_explainable", passed: true, details: ["provenance:complete"] },
    ],
    contaminationFindings: [],
    updateFindings: [],
  };
}

function buildCase(caseId: string): JudgedEvalCase {
  return {
    caseId,
    metadata: {
      taskFamily: "cross_domain_transfer",
      targetDomain: "shopping",
      memorySourceDomains: ["work_ops", "gaming"],
      evaluationSetting: "cross_domain",
      strategyLabel: "rules-only",
      resolvedStrategyLabel: "rules-only",
    },
    baseline: buildAnswerPackage(caseId, "baseline"),
    goodmemory: buildAnswerPackage(caseId, "goodmemory"),
    judge: buildJudgeResult(),
    assertions: buildAssertions(),
  };
}

async function seedSQLiteMemory(sqlitePath: string) {
  await mkdir(dirname(sqlitePath), { recursive: true });
  const documentStore = createSQLiteDocumentStore(sqlitePath);
  const sessionStore = createSQLiteSessionStore(sqlitePath);
  const vectorStore = createInMemoryVectorStore();
  const memory = createGoodMemory({
    adapters: {
      documentStore,
      sessionStore,
      vectorStore,
    },
    storage: {
      provider: "sqlite",
      url: sqlitePath,
    },
  });
  const repositories = createMemoryRepositories({
    documentStore,
    sessionStore,
    vectorStore,
  });
  const scope = {
    userId: "cli-user",
    workspaceId: "workspace-a",
    sessionId: "session-1",
  };
  const timestamp = "2026-01-01T00:00:00.000Z";
  const source = createMemorySource({
    method: "explicit",
    extractedAt: timestamp,
    sessionId: scope.sessionId,
  });

  await repositories.profiles.upsert(
    createUserProfile({
      userId: scope.userId,
      activeContext: {
        currentProjects: ["release quality program"],
        goals: [],
      },
      createdAt: timestamp,
      identity: {
        location: "Austin, USA",
        name: "Felix",
        role: "climate policy advisor",
      },
      updatedAt: timestamp,
    }),
  );
  await repositories.facts.add(
    createFactMemory({
      id: "fact-blocker",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      sessionId: scope.sessionId,
      category: "project",
      content:
        "The current blocker is vendor approval for release quality program.",
      source,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
  await repositories.references.add(
    createReferenceMemory({
      id: "ref-runbook",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      sessionId: scope.sessionId,
      title: "release-quality-runbook.md",
      pointer: "docs/release-quality-runbook.md",
      source,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
  await repositories.feedback.upsert(
    createFeedbackMemory({
      id: "feedback-style",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      sessionId: scope.sessionId,
      kind: "do",
      rule: "Use concise bullet points in summaries.",
      source,
      updatedAt: timestamp,
    }),
  );

  return {
    memory,
    scope,
  };
}

async function seedCodexActionPolicyMemory(input: {
  rule: string;
  evidenceExcerpt: string;
  sessionId: string;
  sqlitePath: string;
  userId: string;
  workspaceId: string;
  why?: string;
}) {
  await mkdir(dirname(input.sqlitePath), { recursive: true });
  const documentStore = createSQLiteDocumentStore(input.sqlitePath);
  const sessionStore = createSQLiteSessionStore(input.sqlitePath);
  const memory = createGoodMemory({
    adapters: {
      documentStore,
      sessionStore,
    },
    storage: {
      provider: "sqlite",
      url: input.sqlitePath,
    },
  });
  const source = createMemorySource({
    method: "explicit",
    extractedAt: "2026-04-22T00:00:00.000Z",
    sessionId: input.sessionId,
  });
  const scope = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
  };

  await documentStore.set(
    "feedback",
    "feedback-policy-1",
    createFeedbackMemory({
      id: "feedback-policy-1",
      userId: input.userId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      kind: "validated_pattern",
      appliesTo: "coding_agent",
      rule: input.rule,
      ...(input.why ? { why: input.why } : {}),
      evidence: ["evidence-policy-1"],
      source,
    }),
  );
  await documentStore.set(
    EVIDENCE_COLLECTION,
    "evidence-policy-1",
    createEvidenceRecord({
      id: "evidence-policy-1",
      userId: input.userId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      kind: input.evidenceExcerpt.includes("blocked")
        ? "verification_result"
        : "correction_context",
      excerpt: input.evidenceExcerpt,
      source,
      sourceMessageIds: ["message-policy-1"],
    }),
  );

  return {
    memory,
    scope,
  };
}

function hasSQLiteTable(sqlitePath: string, tableName: string): boolean {
  const database = new Database(sqlitePath, {
    readonly: true,
    create: false,
    strict: true,
  });

  try {
    const row = database.query<{ name: string }, [string]>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1`,
    ).get(tableName);

    return row !== null && row !== undefined;
  } finally {
    database.close();
  }
}

function dropSQLiteTable(sqlitePath: string, tableName: string): void {
  const database = new Database(sqlitePath, {
    strict: true,
  });

  try {
    database.exec(`DROP TABLE IF EXISTS ${tableName}`);
  } finally {
    database.close();
  }
}

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

describe("goodmemory cli help and routing", () => {
  it("returns package version for -V and --version", async () => {
    const packageJson = JSON.parse(
      await readFile(join(import.meta.dir, "../../package.json"), "utf8"),
    ) as { version: string };

    for (const args of [["-V"], ["--version"]]) {
      const result = await runCLI(args);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(`goodmemory ${packageJson.version}\n`);
      expect(result.stderr).toBe("");
    }
  });

  it("returns version from the installed Node wrapper without requiring Bun", async () => {
    const packageJson = JSON.parse(
      await readFile(join(import.meta.dir, "../../package.json"), "utf8"),
    ) as { version: string };
    const result = Bun.spawnSync({
      cmd: ["node", join(import.meta.dir, "../../scripts/goodmemory-cli.js"), "-V"],
      env: {
        ...process.env,
        GOODMEMORY_BUN_BINARY: "missing-goodmemory-bun",
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(TEXT_DECODER.decode(result.stdout)).toBe(`goodmemory ${packageJson.version}\n`);
    expect(TEXT_DECODER.decode(result.stderr)).toBe("");
  });

  it("returns root help for no args and --help", async () => {
    const noArgs = await runCLI([]);
    const help = await runCLI(["--help"]);

    for (const result of [noArgs, help]) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("GoodMemory CLI");
      expect(result.stdout).toContain("remember        Write durable memory through the public API");
      expect(result.stdout).toContain("feedback        Write explicit feedback or correction through the public API");
      expect(result.stdout).toContain(
        "forget          Delete one durable memory record or clear a scoped target",
      );
      expect(result.stdout).toContain("inspect         Inspect scope-bounded memory");
      expect(result.stdout).toContain(
        "install         Install managed global GoodMemory host config for Codex or Claude Code",
      );
      expect(result.stdout).toContain(
        "enable          Enable repo-local GoodMemory host opt-in for Codex or Claude Code",
      );
      expect(result.stdout).toContain(
        "mcp             Run the installed GoodMemory MCP server",
      );
      expect(result.stdout).toContain(
        "inspector       Run the local GoodMemory Inspector admin surface",
      );
      expect(result.stdout).toContain(
        "storage         Run explicit storage maintenance commands",
      );
      expect(result.stdout).toContain("codex           Codex bootstrap and installed hook commands");
      expect(result.stdout).toContain("claude          Claude Code bootstrap and installed hook commands");
      expect(result.stdout).toContain("goodmemory eval --help");
      expect(result.stdout).toContain("goodmemory install --help");
      expect(result.stdout).toContain("goodmemory mcp --help");
      expect(result.stdout).toContain("goodmemory storage --help");
      expect(result.stdout).toContain("goodmemory inspector --help");
      expect(result.stderr).toBe("");
    }
  });

  it("returns storage migration help without validating connection flags", async () => {
    const bareStorage = await runCLI(["storage"]);
    const storageHelp = await runCLI(["storage", "--help"]);
    const migrationHelp = await runCLI(["storage", "migrate", "--help"]);

    for (const result of [bareStorage, storageHelp]) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("GoodMemory Storage CLI");
      expect(result.stdout).toContain("migrate");
      expect(result.stderr).toBe("");
    }
    expect(migrationHelp.exitCode).toBe(0);
    expect(migrationHelp.stdout).toContain(
      "GoodMemory Postgres Document Index Migration",
    );
    expect(migrationHelp.stdout).toContain("--storage-provider postgres");
    expect(migrationHelp.stdout).toContain("--storage-url <url>");
    expect(migrationHelp.stdout).toContain("--storage-schema <schema>");
    expect(migrationHelp.stderr).toBe("");
  });

  it("runs an explicit Postgres storage migration with secret-free text and JSON output", async () => {
    const storageUrl = "postgres://migration-user:migration-secret@db.example/goodmemory";
    const calls: Array<{ schema?: string; url: string }> = [];
    const dependencies = {
      async migratePostgresStorageBackend(config: { schema?: string; url: string }) {
        calls.push(config);
      },
    };

    const textResult = await runCLI([
      "storage",
      "migrate",
      "--storage-provider",
      "postgres",
      "--storage-url",
      storageUrl,
      "--storage-schema",
      "tenant_memory",
    ], dependencies);
    const jsonResult = await runCLI([
      "storage",
      "migrate",
      "--storage-provider",
      "postgres",
      "--storage-url",
      storageUrl,
      "--json",
    ], dependencies);

    expect(calls).toEqual([
      { schema: "tenant_memory", url: storageUrl },
      { url: storageUrl },
    ]);
    expect(textResult).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "Postgres document-index migration completed for schema tenant_memory.\n",
    });
    expect(JSON.parse(jsonResult.stdout)).toEqual({
      component: "document_indexes",
      provider: "postgres",
      schema: "public",
      status: "migrated",
    });
    for (const output of [
      textResult.stdout,
      textResult.stderr,
      jsonResult.stdout,
      jsonResult.stderr,
    ]) {
      expect(output).not.toContain(storageUrl);
      expect(output).not.toContain("migration-user");
      expect(output).not.toContain("migration-secret");
    }
  });

  it("requires explicit Postgres storage migration flags without invoking the backend", async () => {
    let calls = 0;
    const dependencies = {
      async migratePostgresStorageBackend() {
        calls += 1;
      },
    };

    const missingProvider = await runCLI([
      "storage",
      "migrate",
      "--storage-url",
      "postgres://localhost/goodmemory",
    ], dependencies);
    const missingUrl = await runCLI([
      "storage",
      "migrate",
      "--storage-provider",
      "postgres",
    ], dependencies);
    const sqlite = await runCLI([
      "storage",
      "migrate",
      "--storage-provider",
      "sqlite",
      "--storage-url",
      "/tmp/goodmemory.sqlite",
    ], dependencies);

    expect(missingProvider.exitCode).toBe(1);
    expect(missingProvider.stderr).toContain(
      "Storage migration requires explicit --storage-provider postgres.",
    );
    expect(missingUrl.exitCode).toBe(1);
    expect(missingUrl.stderr).toContain(
      "Postgres storage migration requires --storage-url <url>.",
    );
    expect(sqlite.exitCode).toBe(1);
    expect(sqlite.stderr).toContain(
      "Storage migration only supports --storage-provider postgres.",
    );
    expect(calls).toBe(0);
  });

  it("redacts every failing Postgres document-index migration input", async () => {
    const storageUrl = "postgres://migration-user:migration-secret@db.example/goodmemory";
    const dependency = {
      async migratePostgresStorageBackend() {
        throw new Error(`connection refused for ${storageUrl}`);
      },
    };
    const result = await runCLI([
      "storage",
      "migrate",
      "--storage-provider",
      "postgres",
      "--storage-url",
      storageUrl,
      "--storage-schema",
      "tenant_memory",
    ], dependency);
    const maliciousSchema = "postgres://schema-user:schema-secret@db.example/goodmemory";
    const maliciousResult = await runCLI([
      "storage",
      "migrate",
      "--storage-provider",
      "postgres",
      "--storage-url",
      storageUrl,
      "--storage-schema",
      maliciousSchema,
    ], dependency);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Postgres document-index migration failed.");
    expect(maliciousResult.exitCode).toBe(1);
    expect(maliciousResult.stdout).toBe("");
    expect(maliciousResult.stderr).toBe(
      "Postgres document-index migration failed.",
    );
    for (const output of [result.stderr, maliciousResult.stderr]) {
      expect(output).not.toContain(storageUrl);
      expect(output).not.toContain("migration-user");
      expect(output).not.toContain("migration-secret");
      expect(output).not.toContain("schema-user");
      expect(output).not.toContain("schema-secret");
    }
  });

  it("returns eval namespace help for bare eval and eval --help", async () => {
    const bareEval = await runCLI(["eval"]);
    const evalHelp = await runCLI(["eval", "--help"]);

    for (const result of [bareEval, evalHelp]) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("GoodMemory Eval CLI");
      expect(result.stdout).toContain("inspect       Summarize one eval case");
      expect(result.stdout).toContain("export-case   Copy one eval case artifact");
      expect(result.stderr).toBe("");
    }
  });

  it("returns subcommand help before validating required flags", async () => {
    const inspect = await runCLI(["inspect", "--help"]);
    const remember = await runCLI(["remember", "--help"]);
    const feedback = await runCLI(["feedback", "--help"]);
    const forget = await runCLI(["forget", "--help"]);
    const trace = await runCLI(["trace", "--help"]);
    const stats = await runCLI(["stats", "--help"]);
    const exportMemory = await runCLI(["export-memory", "--help"]);
    const evalInspect = await runCLI(["eval", "inspect", "--help"]);
    const install = await runCLI(["install", "--help"]);
    const installCodex = await runCLI(["install", "codex", "--help"]);
    const setup = await runCLI(["setup", "--help"]);
    const doctor = await runCLI(["doctor", "--help"]);
    const uninstall = await runCLI(["uninstall", "--help"]);
    const repair = await runCLI(["repair", "--help"]);
    const enable = await runCLI(["enable", "--help"]);
    const disable = await runCLI(["disable", "--help"]);
    const status = await runCLI(["status", "--help"]);
    const mcp = await runCLI(["mcp", "--help"]);
    const mcpServe = await runCLI(["mcp", "serve", "--help"]);
    const codex = await runCLI(["codex", "--help"]);
    const codexAction = await runCLI(["codex", "action", "--help"]);
    const codexBootstrap = await runCLI(["codex", "bootstrap", "--help"]);
    const codexHook = await runCLI(["codex", "hook", "--help"]);
    const codexWriteback = await runCLI(["codex", "writeback", "--help"]);
    const claude = await runCLI(["claude", "--help"]);
    const claudeBootstrap = await runCLI(["claude", "bootstrap", "--help"]);
    const claudeHook = await runCLI(["claude", "hook", "--help"]);
    const claudeWriteback = await runCLI(["claude", "writeback", "--help"]);

    expect(remember.exitCode).toBe(0);
    expect(remember.stdout).toContain("GoodMemory Remember");
    expect(remember.stdout).toContain("--message <text>");
    expect(remember.stdout).toContain("--host <codex|claude>");
    expect(feedback.exitCode).toBe(0);
    expect(feedback.stdout).toContain("GoodMemory Feedback");
    expect(feedback.stdout).toContain("--signal <text>");
    expect(forget.exitCode).toBe(0);
    expect(forget.stdout).toContain("GoodMemory Forget");
    expect(forget.stdout).toContain("--memory-id <id>");
    expect(forget.stdout).toContain("--all");
    expect(forget.stdout).toContain(
      "--memory-id <id>        Delete one durable memory record. Use either this or --all",
    );
    expect(forget.stdout).toContain(
      "--all                  Delete the full durable scope. Use either this or --memory-id",
    );
    expect(inspect.exitCode).toBe(0);
    expect(inspect.stdout).toContain("GoodMemory Inspect");
    expect(inspect.stdout).toContain("--user-id <id>");
    expect(trace.exitCode).toBe(0);
    expect(trace.stdout).toContain("GoodMemory Trace");
    expect(trace.stdout).toContain("--ignore-memory");
    expect(trace.stdout).toContain("--strategy <auto|rules-only|hybrid|llm-assisted>");
    expect(stats.exitCode).toBe(0);
    expect(stats.stdout).toContain("GoodMemory Stats");
    expect(exportMemory.exitCode).toBe(0);
    expect(exportMemory.stdout).toContain("GoodMemory Export Memory");
    expect(exportMemory.stdout).toContain("--output <path>");
    expect(evalInspect.exitCode).toBe(0);
    expect(evalInspect.stdout).toContain("GoodMemory Eval Inspect");
    expect(evalInspect.stdout).toContain("--run-dir <path>");
    expect(install.exitCode).toBe(0);
    expect(install.stdout).toContain("GoodMemory Install CLI");
    expect(install.stdout).toContain("goodmemory install <codex|claude>");
    expect(setup.exitCode).toBe(0);
    expect(setup.stdout).toContain("GoodMemory Setup CLI");
    expect(setup.stdout).toContain("--host <codex|claude|both>");
    expect(setup.stdout).toContain("--dry-run");
    expect(doctor.exitCode).toBe(0);
    expect(doctor.stdout).toContain("GoodMemory Doctor CLI");
    expect(doctor.stdout).toContain("goodmemory doctor [codex|claude|both]");
    expect(installCodex.exitCode).toBe(0);
    expect(installCodex.stdout).toContain("--memory-path <path>");
    expect(installCodex.stdout).toContain("--storage-provider <sqlite|postgres>");
    expect(installCodex.stdout).toContain("--activation-mode <global|workspace_opt_in>");
    expect(installCodex.stdout).toContain("--writeback <off|observe|review|selective>");
    expect(installCodex.stdout).toContain("--dry-run");
    expect(installCodex.stdout).toContain("--embedding-provider <openai>");
    expect(installCodex.stdout).toContain("--llm-provider <openai|anthropic>");
    expect(installCodex.stdout).toContain("rules-only mode");
    expect(uninstall.exitCode).toBe(0);
    expect(uninstall.stdout).toContain("GoodMemory Uninstall CLI");
    expect(repair.exitCode).toBe(0);
    expect(repair.stdout).toContain("GoodMemory Repair CLI");
    expect(repair.stdout).toContain("goodmemory repair [codex|claude|both]");
    expect(repair.stdout).toContain("--dry-run");
    expect(enable.exitCode).toBe(0);
    expect(enable.stdout).toContain("GoodMemory Enable CLI");
    expect(enable.stdout).toContain("--workspace-root <path>");
    expect(enable.stdout).toContain("--dry-run");
    expect(disable.exitCode).toBe(0);
    expect(disable.stdout).toContain("GoodMemory Disable CLI");
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain("GoodMemory Status CLI");
    expect(mcp.exitCode).toBe(0);
    expect(mcp.stdout).toContain("GoodMemory MCP CLI");
    expect(mcp.stdout).toContain("goodmemory mcp serve --help");
    expect(mcpServe.exitCode).toBe(0);
    expect(mcpServe.stdout).toContain("GoodMemory MCP Serve");
    expect(mcpServe.stdout).toContain("--host <codex|claude>");
    expect(codex.exitCode).toBe(0);
    expect(codex.stdout).toContain("GoodMemory Codex CLI");
    expect(codex.stdout).toContain("goodmemory codex action --help");
    expect(codex.stdout).toContain("goodmemory codex hook --help");
    expect(codexAction.exitCode).toBe(0);
    expect(codexAction.stdout).toContain("GoodMemory Codex Action");
    expect(codexAction.stdout).toContain("--session-id <id>");
    expect(codexAction.stdout).toContain("--command <command>");
    expect(codexBootstrap.exitCode).toBe(0);
    expect(codexBootstrap.stdout).toContain("GoodMemory Codex Bootstrap");
    expect(codexBootstrap.stdout).toContain("--workspace-root <path>");
    expect(codexHook.exitCode).toBe(0);
    expect(codexHook.stdout).toContain("GoodMemory Codex Hook");
    expect(codexHook.stdout).toContain("pre-tool-use");
    expect(codexHook.stdout).toContain("session-start");
    expect(codexHook.stdout).toContain("session-stop");
    expect(codexWriteback.exitCode).toBe(0);
    expect(codexWriteback.stdout).toContain("GoodMemory Codex Writeback");
    expect(codexWriteback.stdout).toContain("observe    stores local bounded/redacted candidate previews");
    expect(codexWriteback.stdout).toContain("dismisses observe-only events");
    expect(codexWriteback.stdout).toContain("--from-rollout");
    expect(codexWriteback.stdout).toContain("--rollout-path <path>");
    expect(codexWriteback.stdout).toContain("--sessions-root <path>");
    expect(codexWriteback.stdout).toContain("--workspace-root <path>");
    expect(codexWriteback.stdout).toContain("goodmemory codex writeback inspect");
    expect(codexWriteback.stdout).toContain("goodmemory codex writeback forget --event-id <id>");
    expect(claude.exitCode).toBe(0);
    expect(claude.stdout).toContain("GoodMemory Claude CLI");
    expect(claude.stdout).toContain("goodmemory claude hook --help");
    expect(claudeBootstrap.exitCode).toBe(0);
    expect(claudeBootstrap.stdout).toContain("GoodMemory Claude Bootstrap");
    expect(claudeBootstrap.stdout).toContain("--workspace-root <path>");
    expect(claudeHook.exitCode).toBe(0);
    expect(claudeHook.stdout).toContain("GoodMemory Claude Hook");
    expect(claudeHook.stdout).toContain("user-prompt-submit");
    expect(claudeHook.stdout).toContain("session-stop");
    expect(claudeWriteback.exitCode).toBe(0);
    expect(claudeWriteback.stdout).toContain("GoodMemory Claude Writeback");
    expect(claudeWriteback.stdout).toContain("observe    stores local bounded/redacted candidate previews");
    expect(claudeWriteback.stdout).toContain("dismisses observe-only events");
    expect(claudeWriteback.stdout).toContain("goodmemory claude writeback inspect");
    expect(claudeWriteback.stdout).toContain("goodmemory claude writeback forget --event-id <id>");
  });

  it("documents and validates mcp serve standalone mode", async () => {
    const help = await runCLI(["mcp", "serve", "--help"]);
    expect(help.exitCode).toBe(0);
    // Installed-mode pins stay intact alongside the standalone additions.
    expect(help.stdout).toContain("GoodMemory MCP Serve");
    expect(help.stdout).toContain("--host <codex|claude>");
    expect(help.stdout).toContain("--standalone");
    expect(help.stdout).toContain("--allow-write");
    expect(help.stdout).toContain("GOODMEMORY_USER_ID");
    expect(help.stdout).toContain("GOODMEMORY_MCP_ALLOW_WRITE");

    const missingUser = await runCLI(["mcp", "serve", "--standalone"]);
    expect(missingUser.exitCode).toBe(1);
    expect(missingUser.stderr).toContain("--user-id");
    expect(missingUser.stderr).toContain("GOODMEMORY_USER_ID");

    const conflictingModes = await runCLI([
      "mcp",
      "serve",
      "--host",
      "codex",
      "--standalone",
    ]);
    expect(conflictingModes.exitCode).toBe(1);
    expect(conflictingModes.stderr).toContain("mutually exclusive");
  });

  it("returns help hints for unknown root and eval commands", async () => {
    const unknownRoot = await runCLI(["unknown"]);
    const unknownEval = await runCLI(["eval", "unknown"]);
    const unknownInstall = await runCLI(["install", "unknown"]);
    const unknownMcp = await runCLI(["mcp", "unknown"]);
    const unknownCodex = await runCLI(["codex", "unknown"]);
    const unknownClaude = await runCLI(["claude", "unknown"]);

    expect(unknownRoot.exitCode).toBe(1);
    expect(unknownRoot.stderr).toContain("Unknown command: unknown.");
    expect(unknownRoot.stderr).toContain("goodmemory --help");
    expect(unknownEval.exitCode).toBe(1);
    expect(unknownEval.stderr).toContain("Unknown eval command: unknown.");
    expect(unknownEval.stderr).toContain("goodmemory eval --help");
    expect(unknownInstall.exitCode).toBe(1);
    expect(unknownInstall.stderr).toContain("Unknown host target: unknown.");
    expect(unknownMcp.exitCode).toBe(1);
    expect(unknownMcp.stderr).toContain("Unknown MCP command: unknown.");
    expect(unknownMcp.stderr).toContain("goodmemory mcp --help");
    expect(unknownCodex.exitCode).toBe(1);
    expect(unknownCodex.stderr).toContain("Unknown Codex command: unknown.");
    expect(unknownCodex.stderr).toContain("goodmemory codex --help");
    expect(unknownClaude.exitCode).toBe(1);
    expect(unknownClaude.stderr).toContain("Unknown Claude command: unknown.");
    expect(unknownClaude.stderr).toContain("goodmemory claude --help");
  });
});

describe("goodmemory cli host bootstrap", () => {
  it("bootstraps Codex wiring idempotently without creating canonical memory state", async () => {
    const workspace = await createTempWorkspace("goodmemory-codex-bootstrap");

    try {
      await writeFile(join(workspace.root, "AGENTS.md"), "# Existing Workspace Notes\n", "utf8");

      const first = await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );

      expect(first.exitCode).toBe(0);
      const payload = JSON.parse(first.stdout) as {
        changes: Array<{
          action: "created" | "unchanged" | "updated";
          relativePath: string;
        }>;
        host: string;
        workspaceId: string;
      };
      expect(payload.host).toBe("codex");
      expect(payload.workspaceId).toBe("codex-workspace");
      expect(
        payload.changes.map(({ action, relativePath }) => ({
          action,
          relativePath,
        })),
      ).toEqual([
        { action: "updated", relativePath: "AGENTS.md" },
        {
          action: "created",
          relativePath: ".goodmemory/bootstrap/codex-export.mjs",
        },
        {
          action: "created",
          relativePath: ".goodmemory/bootstrap/codex-action.mjs",
        },
        {
          action: "created",
          relativePath: ".codex/hooks.json",
        },
        {
          action: "created",
          relativePath: ".codex/config.toml",
        },
        {
          action: "created",
          relativePath: "codex/rules/goodmemory.rules",
        },
      ]);

      const agents = await readFile(join(workspace.root, "AGENTS.md"), "utf8");
      expect(agents).toContain("# Existing Workspace Notes");
      expect(agents).toContain("## GoodMemory Codex Bootstrap");
      expect(agents).toContain(
        "bun ./.goodmemory/bootstrap/codex-export.mjs --session-id <session-id>",
      );
      expect(agents).toContain(
        'bun ./.goodmemory/bootstrap/codex-action.mjs --session-id <session-id> --command "<command>"',
      );
      expect(agents).toContain(".goodmemory/hosts/codex/session-memory/current.md");
      expect(agents).toContain(".codex/hooks.json");
      expect(agents).toContain("./codex/rules/goodmemory.rules");
      expect(agents).toContain("canonical enforced path");
      expect(agents).toContain("parity scaffolds");
      expect(
        agents.match(/GOODMEMORY-BOOTSTRAP:CODEX START/g)?.length ?? 0,
      ).toBe(1);

      const script = await readFile(
        join(workspace.root, ".goodmemory/bootstrap/codex-export.mjs"),
        "utf8",
      );
      expect(script).toContain('import("goodmemory")');
      expect(script).toContain('import("goodmemory/host")');
      expect(script).toContain("session-memory/current.md");
      expect(script).not.toContain('"codex-active"');
      expect(script).not.toContain("../src");
      expect(script).not.toContain("../../src");
      const actionScript = await readFile(
        join(workspace.root, ".goodmemory/bootstrap/codex-action.mjs"),
        "utf8",
      );
      expect(actionScript).toContain('from "goodmemory"');
      expect(actionScript).toContain('from "goodmemory/host"');
      expect(actionScript).toContain("resolveHostActionExecutionPlan");
      expect(actionScript).not.toContain("../src");
      expect(actionScript).not.toContain("../../src");
      const hooksConfig = await readFile(join(workspace.root, ".codex/hooks.json"), "utf8");
      expect(hooksConfig).toContain("PreToolUse");
      expect(hooksConfig).toContain("codex-action.mjs");
      const hooksToml = await readFile(join(workspace.root, ".codex/config.toml"), "utf8");
      expect(hooksToml).toContain("[features]");
      expect(hooksToml).toContain("hooks = true");
      const rulesFile = await readFile(
        join(workspace.root, "codex/rules/goodmemory.rules"),
        "utf8",
      );
      expect(rulesFile).toContain('pattern = ["deploy"]');
      expect(rulesFile).toContain('pattern = ["DeepAnalyzer"]');
      expect(rulesFile).toContain('pattern = ["rm", "-rf"]');

      let storageExists = true;
      try {
        await access(join(workspace.root, ".goodmemory", "memory.sqlite"));
      } catch {
        storageExists = false;
      }
      expect(storageExists).toBe(false);

      const second = await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );
      const secondPayload = JSON.parse(second.stdout) as typeof payload;
      expect(
        secondPayload.changes.map(({ action, relativePath }) => ({
          action,
          relativePath,
        })),
      ).toEqual([
        { action: "unchanged", relativePath: "AGENTS.md" },
        {
          action: "unchanged",
          relativePath: ".goodmemory/bootstrap/codex-export.mjs",
        },
        {
          action: "unchanged",
          relativePath: ".goodmemory/bootstrap/codex-action.mjs",
        },
        {
          action: "unchanged",
          relativePath: ".codex/hooks.json",
        },
        {
          action: "unchanged",
          relativePath: ".codex/config.toml",
        },
        {
          action: "unchanged",
          relativePath: "codex/rules/goodmemory.rules",
        },
      ]);

      const updatedAgents = await readFile(join(workspace.root, "AGENTS.md"), "utf8");
      expect(
        updatedAgents.match(/GOODMEMORY-BOOTSTRAP:CODEX START/g)?.length ?? 0,
      ).toBe(1);
    } finally {
      await workspace.cleanup();
    }
  });

  it("merges existing repo-local Codex hook and feature config instead of replacing them", async () => {
    const workspace = await createTempWorkspace("goodmemory-codex-bootstrap-merge");

    try {
      await writeFile(
        join(workspace.root, "AGENTS.md"),
        "# Existing Workspace Notes\n",
        "utf8",
      );
      await mkdir(join(workspace.root, ".codex"), { recursive: true });
      await writeFile(
        join(workspace.root, ".codex/hooks.json"),
        JSON.stringify(
          {
            hooks: {
              PostToolUse: [
                {
                  matcher: "Write",
                  hooks: [
                    {
                      type: "command",
                      command: "echo after-write",
                      statusMessage: "after write",
                    },
                  ],
                },
              ],
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      type: "command",
                      command: "echo existing-bash-hook",
                      statusMessage: "keep existing bash hook",
                    },
                  ],
                },
              ],
            },
            repo: {
              preserve: true,
            },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(workspace.root, ".codex/config.toml"),
        [
          "[features]",
          "experimental_feature = true",
          "",
          "[profiles.default]",
          'sandbox = "workspace-write"',
          "",
        ].join("\n"),
        "utf8",
      );

      const first = await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );
      expect(first.exitCode).toBe(0);

      const hooksConfig = JSON.parse(
        await readFile(join(workspace.root, ".codex/hooks.json"), "utf8"),
      ) as {
        hooks: Record<string, Array<{ hooks?: Array<{ command?: string }>; matcher?: string }>>;
        repo?: { preserve?: boolean };
      };
      expect(hooksConfig.repo?.preserve).toBe(true);
      expect(hooksConfig.hooks.PostToolUse).toHaveLength(1);
      const bashHooks = hooksConfig.hooks.PreToolUse.find(
        (entry) => entry.matcher === "Bash",
      )?.hooks;
      expect(bashHooks?.some((hook) => hook.command === "echo existing-bash-hook")).toBe(true);
      expect(
        bashHooks?.some((hook) => hook.command?.includes("codex-action.mjs")),
      ).toBe(true);

      const hooksToml = await readFile(join(workspace.root, ".codex/config.toml"), "utf8");
      expect(hooksToml).toContain("[features]");
      expect(hooksToml).toContain("experimental_feature = true");
      expect(hooksToml).toContain("hooks = true");
      expect(hooksToml).toContain("[profiles.default]");
      expect(hooksToml).toContain('sandbox = "workspace-write"');

      const second = await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );
      expect(second.exitCode).toBe(0);
      const payload = JSON.parse(second.stdout) as {
        changes: Array<{
          action: "created" | "unchanged" | "updated";
          path: string;
          relativePath: string;
        }>;
      };
      expect(
        payload.changes.find((change) => change.relativePath === ".codex/hooks.json"),
      ).toMatchObject({
        action: "unchanged",
        relativePath: ".codex/hooks.json",
      });
      expect(
        payload.changes.find((change) => change.relativePath === ".codex/config.toml"),
      ).toMatchObject({
        action: "unchanged",
        relativePath: ".codex/config.toml",
      });
    } finally {
      await workspace.cleanup();
    }
  });

  it("requires an explicit session id for generated Codex exports", async () => {
    const workspace = await createTempWorkspace("goodmemory-codex-bootstrap-session-required");

    try {
      await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );

      const result = await runBunScript({
        cwd: workspace.root,
        scriptPath: join(workspace.root, ".goodmemory/bootstrap/codex-export.mjs"),
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "Codex export requires --session-id <session-id> to target a real session handoff.",
      );
      await expect(
        access(join(workspace.root, ".goodmemory/hosts/codex/export-manifest.json")),
      ).rejects.toThrow();
    } finally {
      await workspace.cleanup();
    }
  });

  it(
    "anchors generated Codex exports to the bootstrapped workspace root",
    async () => {
    const workspace = await createTempWorkspace("goodmemory-codex-bootstrap-anchor");
    const caller = await createTempWorkspace("goodmemory-codex-bootstrap-caller");

    try {
      await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "workspace-a",
          "--json",
        ]),
      );
      const { scope } = await seedSQLiteMemory(
        join(workspace.root, ".goodmemory", "memory.sqlite"),
      );

      const result = await runBunScript({
        args: ["--session-id", scope.sessionId],
        cwd: caller.root,
        scriptPath: join(workspace.root, ".goodmemory/bootstrap/codex-export.mjs"),
      });

      expect(result.exitCode).toBe(0);

      const manifest = JSON.parse(
        await readFile(
          join(workspace.root, ".goodmemory/hosts/codex/export-manifest.json"),
          "utf8",
        ),
      ) as {
        artifacts: Array<{
          relativePath?: string;
        }>;
        outputRoot: string;
        scope: {
          sessionId?: string;
          workspaceId?: string;
        };
      };
      expect(manifest.outputRoot).toEndWith("/.goodmemory/hosts/codex");
      expect(manifest.outputRoot).toContain(
        (workspace.root.split("/").at(-1) ?? "goodmemory-codex-bootstrap-anchor"),
      );
      expect(manifest.scope.workspaceId).toBe("workspace-a");
      expect(manifest.scope.sessionId).toBe(scope.sessionId);

      await expect(
        access(join(caller.root, ".goodmemory/hosts/codex/export-manifest.json")),
      ).rejects.toThrow();
    } finally {
      await caller.cleanup();
      await workspace.cleanup();
    }
    },
    HOST_BOOTSTRAP_SCRIPT_TEST_TIMEOUT_MS,
  );

  it(
    "generated Codex pre-tool-use hook blocks risky Bash commands and routes them to the action gate",
    async () => {
    const workspace = await createTempWorkspace("goodmemory-codex-hook-policy");
    const sessionId = "consumer-session";
    const packageRoot = join(import.meta.dir, "../..");
    const tarballPath = await packCurrentPackage({
      outputDir: join(workspace.root, ".pack"),
      packageRoot,
    });

    try {
      await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );
      await writeFile(
        join(workspace.root, "package.json"),
        JSON.stringify(
          {
            name: "goodmemory-codex-hook-policy",
            private: true,
            dependencies: {
              goodmemory: `file:${tarballPath}`,
            },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      const install = Bun.spawnSync({
        cmd: ["bun", "install"],
        cwd: workspace.root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(install.exitCode).toBe(0);
      await seedCodexActionPolicyMemory({
        sqlitePath: join(workspace.root, ".goodmemory", "memory.sqlite"),
        sessionId,
        userId: "codex-user",
        workspaceId: "codex-workspace",
        rule: "Before deploy production, run QuickCheck first.",
        evidenceExcerpt:
          "Production deploy was blocked until QuickCheck ran first.",
      });

      const result = await runBunScript({
        args: ["--hook-pre-tool-use"],
        cwd: workspace.root,
        scriptPath: join(workspace.root, ".goodmemory/bootstrap/codex-action.mjs"),
        stdin: JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: sessionId,
          turn_id: "turn-hook-1",
          tool_name: "Bash",
          tool_input: {
            command: "deploy production",
          },
        }),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");
      const payload = JSON.parse(result.stdout) as {
        hookSpecificOutput: {
          hookEventName: string;
          permissionDecision: string;
          permissionDecisionReason: string;
        };
      };
      expect(payload.hookSpecificOutput.hookEventName).toBe("PreToolUse");
      expect(payload.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(payload.hookSpecificOutput.permissionDecisionReason).toContain(
        'bun ./.goodmemory/bootstrap/codex-action.mjs --session-id',
      );
      expect(payload.hookSpecificOutput.permissionDecisionReason).toContain(
        "--command 'deploy production'",
      );
    } finally {
      await workspace.cleanup();
    }
    },
    HOST_BOOTSTRAP_SCRIPT_TEST_TIMEOUT_MS,
  );

  it(
    "generated Codex action gate rewrites risky commands to the recommended first step and records lineage",
    async () => {
    const workspace = await createTempWorkspace("goodmemory-codex-action-gate");
    const sessionId = "consumer-session";
    const sqlitePath = join(workspace.root, ".goodmemory", "memory.sqlite");
    const toolsDir = join(workspace.root, "tools");
    const packageRoot = join(import.meta.dir, "../..");
    const tarballPath = await packCurrentPackage({
      outputDir: join(workspace.root, ".pack"),
      packageRoot,
    });

    try {
      await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );
      await writeFile(
        join(workspace.root, "package.json"),
        JSON.stringify(
          {
            name: "goodmemory-codex-action-gate",
            private: true,
            dependencies: {
              goodmemory: `file:${tarballPath}`,
            },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      const install = Bun.spawnSync({
        cmd: ["bun", "install"],
        cwd: workspace.root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(install.exitCode).toBe(0);
      const { memory, scope } = await seedCodexActionPolicyMemory({
        sqlitePath,
        sessionId,
        userId: "codex-user",
        workspaceId: "codex-workspace",
        rule: "Before deploy production, run QuickCheck first.",
        evidenceExcerpt:
          "Production deploy was blocked until QuickCheck ran first.",
      });

      await mkdir(toolsDir, { recursive: true });
      await writeFile(
        join(toolsDir, "QuickCheck"),
        [
          "#!/usr/bin/env sh",
          `echo quickcheck >> ${JSON.stringify(join(workspace.root, "quickcheck.log"))}`,
        ].join("\n"),
        "utf8",
      );
      await chmod(join(toolsDir, "QuickCheck"), 0o755);
      await writeFile(
        join(toolsDir, "deploy"),
        [
          "#!/usr/bin/env sh",
          `echo deploy >> ${JSON.stringify(join(workspace.root, "deploy.log"))}`,
        ].join("\n"),
        "utf8",
      );
      await chmod(join(toolsDir, "deploy"), 0o755);

      const result = await runBunScript({
        args: [
          "--session-id",
          sessionId,
          "--turn-id",
          "turn-action-1",
          "--command",
          "./tools/deploy production",
          "--json",
        ],
        cwd: workspace.root,
        scriptPath: join(workspace.root, ".goodmemory/bootstrap/codex-action.mjs"),
      });

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        actionId: string;
        decision: string;
        executed: boolean;
        executedStep: string;
        originalActionDeferred: boolean;
        realizedEventParentId: string;
        rewritten: boolean;
      };
      expect(payload.decision).toBe("review_required");
      expect(payload.executed).toBe(true);
      expect(payload.executedStep).toBe("./tools/QuickCheck");
      expect(payload.rewritten).toBe(true);
      expect(payload.originalActionDeferred).toBe(true);
      expect(payload.realizedEventParentId).toBe(payload.actionId);
      const quickCheckExecuted = await access(join(workspace.root, "quickcheck.log"))
        .then(() => true)
        .catch(() => false);
      const deployExecuted = await access(join(workspace.root, "deploy.log"))
        .then(() => true)
        .catch(() => false);
      expect(quickCheckExecuted).toBe(true);
      expect(deployExecuted).toBe(false);

      const exported = await memory.exportMemory({
        scope,
        includeRuntime: true,
      });
      expect(
        exported.durable.experiences.some(
          (record) => record.traceId === payload.actionId,
        ),
      ).toBe(true);
      expect(
        exported.durable.experiences.some(
          (record) =>
            Array.isArray(record.sourceTraceIds) &&
            record.sourceTraceIds.includes(payload.actionId) &&
            record.traceId !== payload.actionId,
        ),
      ).toBe(true);
      expect(
        exported.durable.evidence.some(
          (record) => record.kind === "tool_result_excerpt",
        ),
      ).toBe(true);
    } finally {
      await workspace.cleanup();
    }
    },
    HOST_BOOTSTRAP_SCRIPT_TEST_TIMEOUT_MS,
  );

  it(
    "generated Codex action gate ignores arbitrary SHELL executables and still runs bridged commands on a supported shell",
    async () => {
    const workspace = await createTempWorkspace("goodmemory-codex-action-gate-shell");
    const packageRoot = join(import.meta.dir, "../..");
    const stubShellPath = join(workspace.root, "fake-shell");
    const tarballPath = await packCurrentPackage({
      outputDir: join(workspace.root, ".pack"),
      packageRoot,
    });

    try {
      await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );
      await writeFile(
        join(workspace.root, "package.json"),
        JSON.stringify(
          {
            name: "goodmemory-codex-action-gate-shell",
            private: true,
            dependencies: {
              goodmemory: `file:${tarballPath}`,
            },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      const install = Bun.spawnSync({
        cmd: ["bun", "install"],
        cwd: workspace.root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(install.exitCode).toBe(0);

      await writeFile(
        stubShellPath,
        [
          "#!/usr/bin/env sh",
          "exit 0",
        ].join("\n"),
        "utf8",
      );
      await chmod(stubShellPath, 0o755);

      const result = await runBunScript({
        args: [
          "--session-id",
          "consumer-session",
          "--command",
          "echo hi > proof.txt",
          "--json",
        ],
        cwd: workspace.root,
        env: {
          SHELL: stubShellPath,
        },
        scriptPath: join(workspace.root, ".goodmemory/bootstrap/codex-action.mjs"),
      });

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        executed: boolean;
        exitCode: number;
        rewritten: boolean;
      };
      expect(payload.executed).toBe(true);
      expect(payload.exitCode).toBe(0);
      expect(payload.rewritten).toBe(false);
      expect(await readFile(join(workspace.root, "proof.txt"), "utf8")).toBe("hi\n");
    } finally {
      await workspace.cleanup();
    }
    },
    HOST_BOOTSTRAP_SCRIPT_TEST_TIMEOUT_MS,
  );

  it(
    "generated Codex action gate fails closed when the rewritten first step is not executable on the shell bridge",
    async () => {
    const workspace = await createTempWorkspace("goodmemory-codex-action-gate-fail-closed");
    const sessionId = "consumer-session";
    const sqlitePath = join(workspace.root, ".goodmemory", "memory.sqlite");
    const packageRoot = join(import.meta.dir, "../..");
    const tarballPath = await packCurrentPackage({
      outputDir: join(workspace.root, ".pack"),
      packageRoot,
    });

    try {
      await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );
      await writeFile(
        join(workspace.root, "package.json"),
        JSON.stringify(
          {
            name: "goodmemory-codex-action-gate-fail-closed",
            private: true,
            dependencies: {
              goodmemory: `file:${tarballPath}`,
            },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      const install = Bun.spawnSync({
        cmd: ["bun", "install"],
        cwd: workspace.root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(install.exitCode).toBe(0);
      await seedCodexActionPolicyMemory({
        sqlitePath,
        sessionId,
        userId: "codex-user",
        workspaceId: "codex-workspace",
        rule: "Rather than DeepAnalyzer, use QuickCheck first.",
        evidenceExcerpt:
          "DeepAnalyzer detailed scan failed because QuickCheck had not run first.",
      });

      const result = await runBunScript({
        args: [
          "--session-id",
          sessionId,
          "--turn-id",
          "turn-action-fail-closed",
          "--command",
          "DeepAnalyzer --detailed",
          "--json",
        ],
        cwd: workspace.root,
        scriptPath: join(workspace.root, ".goodmemory/bootstrap/codex-action.mjs"),
      });

      expect(result.exitCode).toBe(2);
      const payload = JSON.parse(result.stdout) as {
        decision: string;
        executed: boolean;
        recommendedFirstStep?: string;
        rewritten: boolean;
      };
      expect(payload.decision).toBe("review_required");
      expect(payload.executed).toBe(false);
      expect(payload.recommendedFirstStep).toBe("run QuickCheck first");
      expect(payload.rewritten).toBe(true);
      const quickCheckExecuted = await access(join(workspace.root, "quickcheck.log"))
        .then(() => true)
        .catch(() => false);
      expect(quickCheckExecuted).toBe(false);
    } finally {
      await workspace.cleanup();
    }
    },
    HOST_BOOTSTRAP_SCRIPT_TEST_TIMEOUT_MS,
  );

  it("bootstraps Claude wiring with a derived workspace id", async () => {
    const workspace = await createTempWorkspace("goodmemory-claude-bootstrap");

    try {
      const result = await withCwd(workspace.root, async () =>
        runCLI(["claude", "bootstrap", "--user-id", "claude-user", "--json"]),
      );

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        changes: Array<{
          action: "created" | "unchanged" | "updated";
          relativePath: string;
        }>;
        host: string;
        workspaceId: string;
      };
      const expectedWorkspaceId =
        workspace.root.split("/").at(-1) ?? "goodmemory-claude-bootstrap";
      expect(payload.host).toBe("claude");
      expect(payload.workspaceId).toBe(expectedWorkspaceId);
      expect(
        payload.changes.map(({ action, relativePath }) => ({
          action,
          relativePath,
        })),
      ).toEqual([
        { action: "created", relativePath: "CLAUDE.md" },
        {
          action: "created",
          relativePath: ".goodmemory/bootstrap/claude-export.mjs",
        },
      ]);

      const instructions = await readFile(join(workspace.root, "CLAUDE.md"), "utf8");
      expect(instructions).toContain("## GoodMemory Claude Code Bootstrap");
      expect(instructions).toContain("bun ./.goodmemory/bootstrap/claude-export.mjs");
      expect(instructions).toContain(".goodmemory/hosts/claude/user.md");
      expect(
        instructions.match(/GOODMEMORY-BOOTSTRAP:CLAUDE START/g)?.length ?? 0,
      ).toBe(1);

      const script = await readFile(
        join(workspace.root, ".goodmemory/bootstrap/claude-export.mjs"),
        "utf8",
      );
      expect(script).toContain('import("goodmemory")');
      expect(script).toContain('import("goodmemory/host")');
      expect(script).not.toContain('"claude-active"');
      expect(script).toContain('readTextFlag(flags, "session-id")');
      expect(script).not.toContain("../src");
    } finally {
      await workspace.cleanup();
    }
  });
});

describe("goodmemory cli installed host config", () => {
  it("installs and uninstalls Codex global middleware config idempotently", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-home");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const first = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--writeback",
            "selective",
            "--json",
          ]);
          expect(first.exitCode).toBe(0);
          const firstPayload = JSON.parse(first.stdout) as {
            changes: Array<{
              action: "created" | "unchanged" | "updated";
              relativePath: string;
            }>;
            configPath: string;
            host: string;
            memoryPath: string;
            userId: string;
          };
          expect(firstPayload.host).toBe("codex");
          expect(firstPayload.userId).toBe("codex-user");
          expect(firstPayload.memoryPath).toBe(join(home.root, ".goodmemory/memory.sqlite"));
          expect(
            firstPayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            {
              action: "created",
              relativePath: "codex.json",
            },
            {
              action: "created",
              relativePath: ".codex/config.toml",
            },
            {
              action: "created",
              relativePath: ".codex/hooks.json",
            },
          ]);

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            host: string;
            storage: { path: string; provider: string };
            userId: string;
          };
          expect(config.host).toBe("codex");
          expect(config.userId).toBe("codex-user");
          expect(config.storage.path).toBe(join(home.root, ".goodmemory/memory.sqlite"));
          const codexConfig = await readFile(join(home.root, ".codex/config.toml"), "utf8");
          expect(codexConfig).toContain('command = "goodmemory-mcp"');
          expect(codexConfig).toContain("hooks = true");
          expect(
            await readFile(join(home.root, ".codex/hooks.json"), "utf8"),
          ).toContain("UserPromptSubmit");

          const second = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(second.exitCode).toBe(0);
          const secondPayload = JSON.parse(second.stdout) as {
            changes: Array<{
              action: "created" | "unchanged" | "updated";
              relativePath: string;
            }>;
          };
          expect(
            secondPayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            {
              action: "unchanged",
              relativePath: "codex.json",
            },
            {
              action: "unchanged",
              relativePath: ".codex/config.toml",
            },
            {
              action: "unchanged",
              relativePath: ".codex/hooks.json",
            },
          ]);

          const uninstall = await runCLI(["uninstall", "codex", "--json"]);
          expect(uninstall.exitCode).toBe(0);
          const uninstallPayload = JSON.parse(uninstall.stdout) as {
            changes: Array<{
              action: "deleted" | "unchanged";
              relativePath: string;
            }>;
          };
          expect(
            uninstallPayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            {
              action: "deleted",
              relativePath: "codex.json",
            },
            {
              action: "deleted",
              relativePath: ".codex/hooks.json",
            },
            {
              action: "deleted",
              relativePath: ".codex/config.toml",
            },
          ]);
          await expect(access(join(home.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".codex/hooks.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".codex/config.toml"))).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("installs Codex provider-backed storage and provider config without leaking secrets", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-provider-home");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--storage-provider",
            "postgres",
            "--storage-url",
            "postgres://postgres:secret@localhost:5432/goodmemory",
            "--embedding-provider",
            "openai",
            "--embedding-model",
            "text-embedding-3-small",
            "--embedding-api-key",
            "embedding-secret",
            "--llm-provider",
            "anthropic",
            "--llm-model",
            "claude-3-5-haiku-latest",
            "--llm-api-key",
            "llm-secret",
            "--json",
          ]);

          expect(result.exitCode).toBe(0);
          expect(result.stdout).not.toContain("embedding-secret");
          expect(result.stdout).not.toContain("llm-secret");
          const payload = JSON.parse(result.stdout) as {
            providers: {
              assistedExtractor: {
                configured: boolean;
                model?: string;
                provider?: string;
              };
              embedding: {
                configured: boolean;
                model?: string;
                provider?: string;
              };
            };
            storage: {
              location: string;
              provider: string;
            };
          };
          expect(payload.storage).toEqual({
            location: "configured",
            provider: "postgres",
          });
          expect(payload.providers.embedding).toMatchObject({
            configured: true,
            model: "text-embedding-3-small",
            provider: "openai",
          });
          expect(payload.providers.assistedExtractor).toMatchObject({
            configured: true,
            model: "claude-3-5-haiku-latest",
            provider: "anthropic",
          });

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            providers: {
              assistedExtractor: {
                apiKey: string;
                model: string;
                provider: string;
              };
              embedding: {
                apiKey: string;
                model: string;
                provider: string;
              };
            };
            storage: {
              provider: string;
              url: string;
            };
          };
          expect(config.storage).toEqual({
            provider: "postgres",
            url: "postgres://postgres:secret@localhost:5432/goodmemory",
          });
          expect(config.providers.embedding).toEqual({
            apiKey: "embedding-secret",
            model: "text-embedding-3-small",
            provider: "openai",
          });
          expect(config.providers.assistedExtractor).toEqual({
            apiKey: "llm-secret",
            model: "claude-3-5-haiku-latest",
            provider: "anthropic",
          });
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("tells installed-host users how to add optional providers later", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-guidance-home");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
          ]);

          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain("embedding provider: not configured");
          expect(result.stdout).toContain("LLM extraction provider: not configured");
          expect(result.stdout).toContain("--embedding-* / --llm-* flags");
          expect(result.stdout).toContain("writeback mode: recall-only");
          expect(result.stdout).toContain("goodmemory enable codex --writeback observe");
          expect(result.stdout).toContain(join(home.root, ".goodmemory/codex.json"));
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("lets users add provider config later by rerunning install", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-later-home");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const initial = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--writeback",
            "selective",
            "--json",
          ]);
          expect(initial.exitCode).toBe(0);

          const configured = await runCLI([
            "install",
            "codex",
            "--embedding-provider",
            "openai",
            "--embedding-model",
            "text-embedding-3-small",
            "--embedding-api-key",
            "embedding-secret",
            "--llm-provider",
            "openai",
            "--llm-model",
            "gpt-4o-mini",
            "--llm-api-key",
            "llm-secret",
            "--json",
          ]);
          expect(configured.exitCode).toBe(0);

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            providers: {
              assistedExtractor: { model: string; provider: string };
              embedding: { model: string; provider: string };
            };
            storage: { path: string; provider: string };
            userId: string;
            writeback: { mode: string };
          };
          expect(config.userId).toBe("codex-user");
          expect(config.writeback.mode).toBe("selective");
          expect(config.storage).toEqual({
            path: join(home.root, ".goodmemory/memory.sqlite"),
            provider: "sqlite",
          });
          expect(config.providers.embedding).toMatchObject({
            model: "text-embedding-3-small",
            provider: "openai",
          });
          expect(config.providers.assistedExtractor).toMatchObject({
            model: "gpt-4o-mini",
            provider: "openai",
          });
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("prompts for installed-host storage and provider config during interactive install", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-interactive-home");
    const prompts: string[] = [];
    const answers = [
      "",
      "codex-user",
      "postgres",
      "postgres://postgres:secret@localhost:5432/goodmemory",
      "yes",
      "text-embedding-3-small",
      "embedding-secret",
      "",
      "yes",
      "openai",
      "gpt-4o-mini",
      "llm-secret",
      "",
      "",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await runCLI(
            [
              "install",
              "codex",
              "--interactive",
              "--json",
            ],
            {
              interactive: true,
              prompt: {
                ask: async (message) => {
                  prompts.push(message);
                  return answers.shift() ?? "";
                },
                askSecret: async (message) => {
                  prompts.push(message);
                  return answers.shift() ?? "";
                },
              },
            },
          );

          expect(result.exitCode).toBe(0);
          expect(result.stdout).not.toContain("embedding-secret");
          expect(result.stdout).not.toContain("llm-secret");
          expect(prompts.join("\n")).toContain("Postgres connection string");
          expect(prompts.join("\n")).toContain("Embedding");
          expect(prompts.join("\n")).toContain("LLM extraction");

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            providers: {
              assistedExtractor: {
                apiKey: string;
                model: string;
                provider: string;
              };
              embedding: {
                apiKey: string;
                model: string;
                provider: string;
              };
            };
            storage: {
              provider: string;
              url: string;
            };
            userId: string;
            writeback: { mode: string };
          };
          expect(config.userId).toBe("codex-user");
          // Fresh interactive installs now recommend selective (capture on,
          // auditable/reversible) instead of observe.
          expect(config.writeback.mode).toBe("selective");
          expect(config.storage).toEqual({
            provider: "postgres",
            url: "postgres://postgres:secret@localhost:5432/goodmemory",
          });
          expect(config.providers.embedding).toEqual({
            apiKey: "embedding-secret",
            model: "text-embedding-3-small",
            provider: "openai",
          });
          expect(config.providers.assistedExtractor).toEqual({
            apiKey: "llm-secret",
            model: "gpt-4o-mini",
            provider: "openai",
          });
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("lets interactive installed-host users skip providers and defer to the managed config path", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-interactive-skip-home");
    const answers = [
      "",
      "",
      "skip",
      "no",
      "no",
      "off",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await runCLI(
            [
              "install",
              "codex",
              "--interactive",
            ],
            {
              interactive: true,
              prompt: {
                ask: async () => answers.shift() ?? "",
                askSecret: async () => answers.shift() ?? "",
              },
            },
          );

          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain("embedding provider: not configured");
          expect(result.stdout).toContain("LLM extraction provider: not configured");
          expect(result.stdout).toContain(join(home.root, ".goodmemory/codex.json"));

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            providers?: unknown;
            storage: {
              path: string;
              provider: string;
            };
          };
          expect(config.providers).toBeUndefined();
          expect(config.storage).toEqual({
            path: join(home.root, ".goodmemory/memory.sqlite"),
            provider: "sqlite",
          });
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("uses interactive global activation as the default installed-host path", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-interactive-global-home");
    const workspace = await createTempWorkspace(
      "goodmemory-codex-install-interactive-global-workspace",
    );
    const answers = [
      "global",
      "",
      "sqlite",
      "no",
      "no",
      "selective",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI(
              [
                "install",
                "codex",
                "--interactive",
                "--json",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => answers.shift() ?? "",
                  askSecret: async () => answers.shift() ?? "",
                },
              },
            ),
          );

          expect(result.exitCode).toBe(0);
          const payload = JSON.parse(result.stdout) as {
            activationMode: string;
            writeback: { mode: string };
          };
          expect(payload.activationMode).toBe("global");
          expect(payload.writeback.mode).toBe("selective");
          await expect(access(join(workspace.root, ".goodmemory/codex.json"))).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("can install and enable the current workspace from the interactive flow", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-current-workspace-home");
    const workspace = await createTempWorkspace(
      "goodmemory-codex-install-current-workspace-workspace",
    );
    const answers = [
      "current-workspace",
      "",
      "sqlite",
      "no",
      "no",
      "off",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI(
              [
                "install",
                "codex",
                "--interactive",
                "--json",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => answers.shift() ?? "",
                  askSecret: async () => answers.shift() ?? "",
                },
              },
            ),
          );

          expect(result.exitCode).toBe(0);
          const config = JSON.parse(
            await readFile(join(workspace.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            enabled: boolean;
          };
          expect(config.enabled).toBe(true);
          expect(await readFile(join(workspace.root, "AGENTS.md"), "utf8")).toContain(
            "GOODMEMORY-INSTALL:CODEX START",
          );
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("rolls back the global install when current-workspace enable fails", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-rollback-home");
    const workspace = await createTempWorkspace("goodmemory-codex-install-rollback-workspace");
    const answers = [
      "current-workspace",
      "",
      "sqlite",
      "no",
      "no",
      "off",
    ];

    try {
      await writeFile(
        join(workspace.root, "AGENTS.md"),
        [
          "# Existing Notes",
          "<!-- GOODMEMORY-INSTALL:CODEX START -->",
          "broken block",
        ].join("\n"),
        "utf8",
      );

      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI(
              [
                "install",
                "codex",
                "--interactive",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => answers.shift() ?? "",
                  askSecret: async () => answers.shift() ?? "",
                },
              },
            ),
          );

          expect(result.exitCode).toBe(1);
          expect(result.stderr).toContain("managed install block is malformed");
          await expect(access(join(home.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".codex/hooks.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".codex/config.toml"))).rejects.toThrow();
          await expect(access(join(workspace.root, ".goodmemory/codex.json"))).rejects.toThrow();
          expect(await readFile(join(workspace.root, "AGENTS.md"), "utf8")).toContain(
            "broken block",
          );
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("keeps manual activation script-safe in non-interactive install mode", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-manual-home");
    const workspace = await createTempWorkspace("goodmemory-codex-install-manual-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI([
              "install",
              "codex",
              "--user-id",
              "codex-user",
              "--json",
            ]),
          );

          expect(result.exitCode).toBe(0);
          const payload = JSON.parse(result.stdout) as {
            activationMode: string;
          };
          expect(payload.activationMode).toBe("workspace_opt_in");
          await expect(access(join(workspace.root, ".goodmemory/codex.json"))).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("plans install without writing managed files in dry-run mode", async () => {
    const home = await createTempWorkspace("goodmemory-install-dry-run-home");
    const workspace = await createTempWorkspace("goodmemory-install-dry-run-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI([
              "install",
              "codex",
              "--activation-mode",
              "global",
              "--context-mode",
              "progressive",
              "--storage-provider",
              "postgres",
              "--storage-url",
              "postgres://example/db",
              "--embedding-provider",
              "openai",
              "--embedding-model",
              "text-embedding-3-small",
              "--embedding-api-key",
              "sk-test",
              "--llm-provider",
              "anthropic",
              "--llm-model",
              "claude-haiku",
              "--llm-api-key",
              "sk-llm",
              "--writeback",
              "selective",
              "--user-id",
              "codex-user",
              "--dry-run",
              "--json",
            ]),
          );

          expect(result.exitCode).toBe(0);
          const payload = JSON.parse(result.stdout) as {
            dryRun: boolean;
            hosts: Array<{
              activationMode: string;
              contextMode: string;
              host: string;
              plannedChanges: Array<{ path: string }>;
              providers: {
                assistedExtractor: { configured: boolean; provider: string };
                embedding: { configured: boolean; provider: string };
              };
              storage: { location: string; provider: string };
              userId: string;
              writeback: { mode: string };
            }>;
          };
          expect(payload.dryRun).toBe(true);
          expect(payload.hosts[0]?.host).toBe("codex");
          expect(payload.hosts[0]?.activationMode).toBe("global");
          expect(payload.hosts[0]?.contextMode).toBe("progressive");
          expect(payload.hosts[0]?.writeback.mode).toBe("selective");
          expect(payload.hosts[0]?.storage).toEqual({
            location: "configured",
            provider: "postgres",
          });
          expect(payload.hosts[0]?.userId).toBe("codex-user");
          expect(payload.hosts[0]?.providers.embedding.configured).toBe(true);
          expect(payload.hosts[0]?.providers.embedding.provider).toBe("openai");
          expect(payload.hosts[0]?.providers.assistedExtractor.configured).toBe(true);
          expect(payload.hosts[0]?.providers.assistedExtractor.provider).toBe("anthropic");
          expect(payload.hosts[0]?.plannedChanges.length).toBeGreaterThan(0);
          await expect(access(join(home.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".codex/hooks.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".codex/config.toml"))).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it(
    "plans install dry-run from existing config when options are omitted",
    async () => {
      const home = await createTempWorkspace("goodmemory-install-dry-run-existing-home");
      const workspace = await createTempWorkspace(
        "goodmemory-install-dry-run-existing-workspace",
      );

      try {
        await withEnv(
          {
            GOODMEMORY_HOME: home.root,
          },
          async () => {
            const install = await withCwd(workspace.root, async () =>
              runCLI([
                "install",
                "codex",
                "--activation-mode",
                "global",
                "--context-mode",
                "progressive",
                "--storage-provider",
                "postgres",
                "--storage-url",
                "postgres://example/db",
                "--embedding-provider",
                "openai",
                "--embedding-model",
                "text-embedding-3-small",
                "--embedding-api-key",
                "sk-test",
                "--llm-provider",
                "anthropic",
                "--llm-model",
                "claude-haiku",
                "--llm-api-key",
                "sk-llm",
                "--writeback",
                "selective",
                "--user-id",
                "existing-user",
                "--json",
              ]),
            );
            expect(install.exitCode).toBe(0);

            const plan = await withCwd(workspace.root, async () =>
              runCLI(["install", "codex", "--dry-run", "--json"]),
            );

            expect(plan.exitCode).toBe(0);
            const payload = JSON.parse(plan.stdout) as {
              hosts: Array<{
                contextMode: string;
                providers: {
                  assistedExtractor: { configured: boolean; provider: string };
                  embedding: { configured: boolean; provider: string };
                };
                storage: { location: string; provider: string };
                userId: string;
                writeback: { mode: string };
              }>;
            };
            expect(payload.hosts[0]?.contextMode).toBe("progressive");
            expect(payload.hosts[0]?.storage).toEqual({
              location: "configured",
              provider: "postgres",
            });
            expect(payload.hosts[0]?.userId).toBe("existing-user");
            expect(payload.hosts[0]?.writeback.mode).toBe("selective");
            expect(payload.hosts[0]?.providers.embedding.configured).toBe(true);
            expect(payload.hosts[0]?.providers.embedding.provider).toBe("openai");
            expect(payload.hosts[0]?.providers.assistedExtractor.configured).toBe(true);
            expect(payload.hosts[0]?.providers.assistedExtractor.provider).toBe("anthropic");
          },
        );
      } finally {
        await home.cleanup();
        await workspace.cleanup();
      }
    },
    HOST_BOOTSTRAP_SCRIPT_TEST_TIMEOUT_MS,
  );

  it("validates dry-run install storage options like the real installer path", async () => {
    const home = await createTempWorkspace("goodmemory-install-dry-run-validation-home");
    const workspace = await createTempWorkspace(
      "goodmemory-install-dry-run-validation-workspace",
    );

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI([
              "install",
              "codex",
              "--storage-provider",
              "postgres",
              "--dry-run",
              "--json",
            ]),
          );

          expect(result.exitCode).toBe(1);
          expect(result.stderr).toContain(
            "Postgres installed-host storage requires --storage-url.",
          );
          const blankUrl = await withCwd(workspace.root, async () =>
            runCLI([
              "install",
              "codex",
              "--storage-provider",
              "sqlite",
              "--storage-url",
              "   ",
              "--dry-run",
              "--json",
            ]),
          );
          expect(blankUrl.exitCode).toBe(1);
          expect(blankUrl.stderr).toContain(
            "Installed-host --storage-url must be a non-empty string.",
          );
          await expect(access(join(home.root, ".goodmemory/codex.json"))).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("plans setup and enable without writing workspace files in dry-run mode", async () => {
    const home = await createTempWorkspace("goodmemory-setup-enable-dry-run-home");
    const workspace = await createTempWorkspace("goodmemory-setup-enable-dry-run-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const setup = await withCwd(workspace.root, async () =>
            runCLI([
              "setup",
              "--host",
              "codex",
              "--activation-mode",
              "workspace_opt_in",
              "--dry-run",
              "--json",
            ]),
          );
          expect(setup.exitCode).toBe(0);
          const setupPayload = JSON.parse(setup.stdout) as {
            dryRun: boolean;
            hosts: Array<{ plannedChanges: Array<{ path: string }> }>;
          };
          expect(setupPayload.dryRun).toBe(true);
          expect(setupPayload.hosts[0]?.plannedChanges.some((change) =>
            change.path.endsWith(".goodmemory/codex.json"),
          )).toBe(true);
          await expect(access(join(home.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(access(join(workspace.root, ".goodmemory/codex.json"))).rejects.toThrow();

          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
          const enable = await withCwd(workspace.root, async () =>
            runCLI([
              "enable",
              "codex",
              "--workspace-root",
              workspace.root,
              "--writeback",
              "observe",
              "--dry-run",
              "--json",
            ]),
          );
          expect(enable.exitCode).toBe(0);
          const enablePayload = JSON.parse(enable.stdout) as {
            dryRun: boolean;
            hosts: Array<{ plannedChanges: Array<{ path: string }> }>;
          };
          expect(enablePayload.dryRun).toBe(true);
          const enablePlannedPaths =
            enablePayload.hosts[0]?.plannedChanges.map((change) => change.path) ?? [];
          expect(enablePlannedPaths).toContain(join(home.root, ".goodmemory/codex.json"));
          expect(enablePayload.hosts[0]?.plannedChanges.some((change) =>
            change.path.endsWith("AGENTS.md"),
          )).toBe(true);
          expect(enablePlannedPaths.some((path) => path.endsWith(".codex/hooks.json"))).toBe(false);
          expect(enablePlannedPaths.some((path) => path.endsWith(".codex/config.toml"))).toBe(false);
          await expect(access(join(workspace.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(access(join(workspace.root, "AGENTS.md"))).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("plans current-workspace install and setup dry-runs with workspace opt-in files", async () => {
    const installHome = await createTempWorkspace(
      "goodmemory-install-current-workspace-dry-run-home",
    );
    const setupHome = await createTempWorkspace(
      "goodmemory-setup-current-workspace-dry-run-home",
    );
    const installWorkspace = await createTempWorkspace(
      "goodmemory-install-current-workspace-dry-run-workspace",
    );
    const setupWorkspace = await createTempWorkspace(
      "goodmemory-setup-current-workspace-dry-run-workspace",
    );

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: installHome.root,
        },
        async () => {
          const installAnswers = [
            "current-workspace",
            "",
            "sqlite",
            "no",
            "no",
            "off",
          ];
          const install = await withCwd(installWorkspace.root, async () =>
            runCLI(
              [
                "install",
                "codex",
                "--interactive",
                "--dry-run",
                "--json",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => installAnswers.shift() ?? "",
                  askSecret: async () => installAnswers.shift() ?? "",
                },
              },
            ),
          );

          expect(install.exitCode).toBe(0);
          const payload = JSON.parse(install.stdout) as {
            hosts: Array<{ plannedChanges: Array<{ path: string }> }>;
          };
          const paths =
            payload.hosts[0]?.plannedChanges.map((change) =>
              change.path.replace(/^\/private\//u, "/"),
            ) ?? [];
          expect(paths).toContain(
            join(installWorkspace.root, ".goodmemory/codex.json").replace(
              /^\/private\//u,
              "/",
            ),
          );
          expect(paths).toContain(
            join(installWorkspace.root, "AGENTS.md").replace(/^\/private\//u, "/"),
          );
          await expect(access(join(installHome.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(
            access(join(installWorkspace.root, ".goodmemory/codex.json")),
          ).rejects.toThrow();
        },
      );

      await withEnv(
        {
          GOODMEMORY_HOME: setupHome.root,
        },
        async () => {
          const setupAnswers = [
            "codex",
            "current-workspace",
            "",
            "sqlite",
            "no",
            "no",
            "off",
          ];
          const setup = await withCwd(setupWorkspace.root, async () =>
            runCLI(
              [
                "setup",
                "--interactive",
                "--dry-run",
                "--json",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => setupAnswers.shift() ?? "",
                  askSecret: async () => setupAnswers.shift() ?? "",
                },
              },
            ),
          );

          expect(setup.exitCode).toBe(0);
          const payload = JSON.parse(setup.stdout) as {
            hosts: Array<{ plannedChanges: Array<{ path: string }> }>;
          };
          const paths =
            payload.hosts[0]?.plannedChanges.map((change) =>
              change.path.replace(/^\/private\//u, "/"),
            ) ?? [];
          expect(paths).toContain(
            join(setupWorkspace.root, ".goodmemory/codex.json").replace(
              /^\/private\//u,
              "/",
            ),
          );
          expect(paths).toContain(
            join(setupWorkspace.root, "AGENTS.md").replace(/^\/private\//u, "/"),
          );
          await expect(access(join(setupHome.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(
            access(join(setupWorkspace.root, ".goodmemory/codex.json")),
          ).rejects.toThrow();
        },
      );
    } finally {
      await installHome.cleanup();
      await setupHome.cleanup();
      await installWorkspace.cleanup();
      await setupWorkspace.cleanup();
    }
  });

  it("reports installer doctor diagnostics without mutating host state", async () => {
    const home = await createTempWorkspace("goodmemory-doctor-home");
    const workspace = await createTempWorkspace("goodmemory-doctor-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const missing = await withCwd(workspace.root, async () =>
            runCLI([
              "doctor",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(missing.exitCode).toBe(0);
          const missingPayload = JSON.parse(missing.stdout) as {
            hosts: Array<{
              config: string;
              repairable: boolean;
              nextCommands: string[];
            }>;
          };
          expect(missingPayload.hosts[0]?.config).toBe("missing");
          expect(missingPayload.hosts[0]?.repairable).toBe(false);
          expect(missingPayload.hosts[0]?.nextCommands).toContain("goodmemory setup --host codex");
          await expect(access(join(home.root, ".goodmemory/codex.json"))).rejects.toThrow();

          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--context-mode",
            "progressive",
            "--writeback",
            "off",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
          await rm(join(home.root, ".codex/hooks.json"), { force: true });

          const doctor = await withCwd(workspace.root, async () =>
            runCLI([
              "doctor",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(doctor.exitCode).toBe(0);
          const payload = JSON.parse(doctor.stdout) as {
            hosts: Array<{
              contextMode: string;
              hookRegistered: boolean;
              repairable: boolean;
              writeback: { mode: string };
            }>;
          };
          expect(payload.hosts[0]?.contextMode).toBe("progressive");
          expect(payload.hosts[0]?.writeback.mode).toBe("off");
          expect(payload.hosts[0]?.hookRegistered).toBe(false);
          expect(payload.hosts[0]?.repairable).toBe(true);
          await expect(access(join(home.root, ".codex/hooks.json"))).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("reports unmanaged MCP conflicts as manual-fix diagnostics instead of repairable", async () => {
    const home = await createTempWorkspace("goodmemory-doctor-conflict-home");
    const workspace = await createTempWorkspace("goodmemory-doctor-conflict-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
          await writeFile(
            join(home.root, ".codex/config.toml"),
            [
              "[mcp_servers.goodmemory]",
              "command = \"custom-goodmemory-mcp\"",
              "args = [\"--host\", \"codex\"]",
              "",
            ].join("\n"),
            "utf8",
          );

          const doctor = await withCwd(workspace.root, async () =>
            runCLI([
              "doctor",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(doctor.exitCode).toBe(0);
          const payload = JSON.parse(doctor.stdout) as {
            hosts: Array<{
              nextCommands: string[];
              repairable: boolean;
              warnings: string[];
            }>;
          };
          expect(payload.hosts[0]?.repairable).toBe(false);
          expect(payload.hosts[0]?.nextCommands).not.toContain("goodmemory repair codex");
          expect(payload.hosts[0]?.warnings.join("\n")).toContain("MCP");

          const persisted = await readFile(join(home.root, ".codex/config.toml"), "utf8");
          expect(persisted).toContain("custom-goodmemory-mcp");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("labels the preAction hook in doctor output only for hosts that register one", async () => {
    const home = await createTempWorkspace("goodmemory-doctor-preaction-home");
    const workspace = await createTempWorkspace("goodmemory-doctor-preaction-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          for (const host of ["claude", "codex"] as const) {
            const install = await runCLI([
              "install",
              host,
              "--activation-mode",
              "global",
              "--writeback",
              "off",
              "--user-id",
              `${host}-user`,
              "--json",
            ]);
            expect(install.exitCode).toBe(0);
          }

          const claudeDoctor = await withCwd(workspace.root, async () =>
            runCLI(["doctor", "claude", "--workspace-root", workspace.root]),
          );
          expect(claudeDoctor.exitCode).toBe(0);
          const claudeHooksLine = claudeDoctor.stdout
            .split("\n")
            .find((line) => line.includes("- hooks:"));
          expect(claudeHooksLine).toContain("recall=registered");
          expect(claudeHooksLine).toContain("mcp=registered");
          // Claude never registers a preAction hook, so the label would only
          // read as a false "missing" defect.
          expect(claudeHooksLine).not.toContain("preAction");

          const codexDoctor = await withCwd(workspace.root, async () =>
            runCLI(["doctor", "codex", "--workspace-root", workspace.root]),
          );
          expect(codexDoctor.exitCode).toBe(0);
          const codexHooksLine = codexDoctor.stdout
            .split("\n")
            .find((line) => line.includes("- hooks:"));
          expect(codexHooksLine).toContain("preAction=registered");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("returns nonzero when repair cannot fix an explicit missing host install", async () => {
    const home = await createTempWorkspace("goodmemory-repair-missing-home");
    const workspace = await createTempWorkspace("goodmemory-repair-missing-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const repair = await withCwd(workspace.root, async () =>
            runCLI([
              "repair",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(repair.exitCode).toBe(1);
          const payload = JSON.parse(repair.stdout) as {
            hosts: Array<{
              config: string;
              skipped: boolean;
            }>;
          };
          expect(payload.hosts[0]?.config).toBe("missing");
          expect(payload.hosts[0]?.skipped).toBe(true);
          await expect(access(join(home.root, ".goodmemory/codex.json"))).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("repairs missing managed hook and MCP files while preserving review writeback mode", async () => {
    const home = await createTempWorkspace("goodmemory-repair-home");
    const workspace = await createTempWorkspace("goodmemory-repair-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--writeback",
            "review",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
          const globalConfigPath = join(home.root, ".goodmemory/codex.json");
          const globalConfigBeforeRepair = await readFile(globalConfigPath, "utf8");
          await rm(join(home.root, ".codex/hooks.json"), { force: true });
          await rm(join(home.root, ".codex/config.toml"), { force: true });

          const dryRun = await withCwd(workspace.root, async () =>
            runCLI([
              "repair",
              "codex",
              "--workspace-root",
              workspace.root,
              "--dry-run",
              "--json",
            ]),
          );
          expect(dryRun.exitCode).toBe(0);
          await expect(access(join(home.root, ".codex/hooks.json"))).rejects.toThrow();

          const repair = await withCwd(workspace.root, async () =>
            runCLI([
              "repair",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(repair.exitCode).toBe(0);
          const payload = JSON.parse(repair.stdout) as {
            hosts: Array<{
              changes: Array<{ path: string }>;
              writeback: { mode: string };
            }>;
          };
          expect(payload.hosts[0]?.writeback.mode).toBe("review");
          expect(payload.hosts[0]?.changes.some((change) =>
            change.path.endsWith(".codex/hooks.json"),
          )).toBe(true);
          await expect(readFile(globalConfigPath, "utf8")).resolves.toBe(
            globalConfigBeforeRepair,
          );

          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          const statusPayload = JSON.parse(status.stdout) as {
            hosts: Array<{
              hookRegistered: boolean;
              mcpRegistered: boolean;
              preActionRegistered: boolean;
              writeback: { mode: string };
            }>;
          };
          expect(statusPayload.hosts[0]?.hookRegistered).toBe(true);
          expect(statusPayload.hosts[0]?.mcpRegistered).toBe(true);
          expect(statusPayload.hosts[0]?.preActionRegistered).toBe(true);
          expect(statusPayload.hosts[0]?.writeback.mode).toBe("review");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("surfaces writeback capture activity in status output", async () => {
    const home = await createTempWorkspace("goodmemory-status-activity-home");
    const workspace = await createTempWorkspace("goodmemory-status-activity-workspace");

    try {
      await mkdir(join(home.root, ".goodmemory"), { recursive: true });
      const writeConfig = async (mode: "off" | "selective") =>
        writeFile(
          join(home.root, ".goodmemory/claude.json"),
          JSON.stringify(
            {
              activationMode: "global",
              host: "claude",
              maxTokens: 256,
              retrievalProfile: "coding_agent",
              storage: {
                path: join(home.root, ".goodmemory/memory.sqlite"),
                provider: "sqlite",
              },
              userId: "activity-user",
              version: 1,
              writeback: { mode },
            },
            null,
            2,
          ) + "\n",
          "utf8",
        );
      await writeConfig("selective");

      const scopeDigest = buildWritebackScopeDigest({
        agentId: "claude",
        userId: "activity-user",
        workspaceId: basename(workspace.root),
      });
      const buildEvent = (input: {
        eventId: string;
        occurredAt: string;
        recallHitCount?: number;
        scopeDigest?: string;
        sessionDigest: string;
        status?: string;
      }) => ({
        candidateKey: `sha256:${input.eventId}`,
        command: "turn-end",
        contentPreview: "bounded preview",
        eventId: input.eventId,
        forgottenLinkedRecordIds: [],
        forgottenMemoryIds: [],
        host: "claude",
        kind: "fact",
        linkedRecordIds: [],
        memoryIds: [`memory-${input.eventId}`],
        mode: "selective",
        occurredAt: input.occurredAt,
        reason: "decision",
        recallHitCount: input.recallHitCount ?? 0,
        recalledBy: [],
        scopeDigest: input.scopeDigest ?? scopeDigest,
        sessionDigest: input.sessionDigest,
        source: "user",
        status: input.status ?? "committed",
        updatedAt: input.occurredAt,
      });
      await writeFile(
        join(home.root, ".goodmemory/claude-writeback-events.json"),
        JSON.stringify(
          {
            auditEvents: [
              buildEvent({
                eventId: "evt-early",
                occurredAt: "2026-07-04T10:00:00.000Z",
                sessionDigest: "session:aaa",
              }),
              buildEvent({
                eventId: "evt-latest",
                occurredAt: "2026-07-05T09:00:00.000Z",
                recallHitCount: 2,
                sessionDigest: "session:bbb",
              }),
              buildEvent({
                eventId: "evt-foreign-scope",
                occurredAt: "2026-07-05T09:30:00.000Z",
                scopeDigest: "scope:other",
                sessionDigest: "session:ccc",
              }),
              buildEvent({
                eventId: "evt-observed",
                occurredAt: "2026-07-05T09:45:00.000Z",
                sessionDigest: "session:bbb",
                status: "observed",
              }),
            ],
            events: [],
            pending: [],
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "claude",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(status.exitCode).toBe(0);
          const payload = JSON.parse(status.stdout) as {
            hosts: Array<{
              writebackActivity?: {
                committedTotal: number;
                lastCapturedAt: string | null;
                lastSessionCaptured: number;
                recallHitEvents: number;
              };
            }>;
          };
          // Only committed events in the current scope count; the foreign
          // scope and the observed (non-durable) event stay out.
          expect(payload.hosts[0]?.writebackActivity).toEqual({
            committedTotal: 2,
            lastCapturedAt: "2026-07-05T09:00:00.000Z",
            lastSessionCaptured: 1,
            recallHitEvents: 1,
          });

          const text = await withCwd(workspace.root, async () =>
            runCLI(["status", "claude", "--workspace-root", workspace.root]),
          );
          expect(text.stdout).toContain(
            "captured: 1 memory last session (1 recalled in later sessions)",
          );
          expect(text.stdout).toContain("goodmemory claude writeback inspect");

          // Capture off: status points at the enable command instead.
          await writeConfig("off");
          const offText = await withCwd(workspace.root, async () =>
            runCLI(["status", "claude", "--workspace-root", workspace.root]),
          );
          expect(offText.stdout).toContain(
            "capture: off — enable: goodmemory enable claude --writeback selective",
          );
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("reports the retrieval tier in status and flags preset misconfiguration in doctor", async () => {
    const home = await createTempWorkspace("goodmemory-retrieval-tier-home");
    const workspace = await createTempWorkspace("goodmemory-retrieval-tier-workspace");

    try {
      await mkdir(join(home.root, ".goodmemory"), { recursive: true });
      const writeConfig = async (extra: Record<string, unknown>) =>
        writeFile(
          join(home.root, ".goodmemory/claude.json"),
          JSON.stringify(
            {
              activationMode: "global",
              host: "claude",
              maxTokens: 256,
              retrievalProfile: "coding_agent",
              storage: {
                path: join(home.root, ".goodmemory/memory.sqlite"),
                provider: "sqlite",
              },
              userId: "tier-user",
              version: 1,
              writeback: { mode: "off" },
              ...extra,
            },
            null,
            2,
          ) + "\n",
          "utf8",
        );

      await withEnv(
        {
          GOODMEMORY_EMBEDDING_API_KEY: undefined,
          GOODMEMORY_EMBEDDING_MODEL: undefined,
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          await writeConfig({ retrieval: { bm25Ranking: true } });
          const bm25Status = await withCwd(workspace.root, async () =>
            runCLI(["status", "claude", "--workspace-root", workspace.root]),
          );
          expect(bm25Status.stdout).toContain("- retrieval: bm25-hybrid");

          // Shared reads + injection telemetry surface alongside the tier.
          await writeFile(
            join(home.root, ".goodmemory/claude-injection-state.json"),
            JSON.stringify(
              {
                events: [
                  {
                    at: "2026-07-05T10:00:00.000Z",
                    command: "user-prompt-submit",
                    decision: "injected",
                    estimatedTokens: 120,
                    recallLatencyMs: 40,
                    recordIds: ["fact-1"],
                  },
                  {
                    at: "2026-07-05T10:01:00.000Z",
                    command: "user-prompt-submit",
                    decision: "low_relevance",
                    estimatedTokens: 0,
                    recallLatencyMs: 20,
                    recordIds: [],
                  },
                ],
                sessions: {},
                version: 1,
              },
              null,
              2,
            ) + "\n",
            "utf8",
          );
          await writeConfig({
            retrieval: { bm25Ranking: true },
            sharedAgents: ["codex"],
          });
          const sharedStatus = await withCwd(workspace.root, async () =>
            runCLI(["status", "claude", "--workspace-root", workspace.root]),
          );
          expect(sharedStatus.stdout).toContain("- shared reads: codex");
          expect(sharedStatus.stdout).toContain(
            "- injection (last 2): injected 1, gated 1, avg recall 30ms",
          );

          await writeConfig({});
          const floorStatus = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "claude",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          const floorPayload = JSON.parse(floorStatus.stdout) as {
            hosts: Array<{ retrievalTier?: string }>;
          };
          expect(floorPayload.hosts[0]?.retrievalTier).toBe("rules-only");

          // Provider-free recommended retrieval is a valid deterministic tier;
          // doctor must not report it as a fail-open configuration.
          await writeConfig({ retrieval: { preset: "recommended" } });
          const doctor = await withCwd(workspace.root, async () =>
            runCLI([
              "doctor",
              "claude",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          const doctorPayload = JSON.parse(doctor.stdout) as {
            hosts: Array<{ warnings: string[] }>;
          };
          expect(
            doctorPayload.hosts[0]?.warnings.some((warning) =>
              warning.includes("retrieval.preset"),
            ),
          ).toBe(false);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("composes recommended setup behind an explicit consent gate", async () => {
    const home = await createTempWorkspace("goodmemory-recommended-home");
    const workspace = await createTempWorkspace("goodmemory-recommended-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          // Without consent (no --yes, non-interactive): refuse with guidance,
          // write nothing.
          const refused = await withCwd(workspace.root, async () =>
            runCLI(["setup", "--recommended", "--host", "claude"]),
          );
          expect(refused.exitCode).toBe(1);
          expect(refused.stderr).toContain("--yes");
          await expect(
            readFile(join(home.root, ".goodmemory/claude.json"), "utf8"),
          ).rejects.toThrow();

          // Explicit --yes: applies global activation + selective writeback
          // and prints the capture commitments.
          const applied = await withCwd(workspace.root, async () =>
            runCLI([
              "setup",
              "--recommended",
              "--host",
              "claude",
              "--user-id",
              "recommended-user",
              "--yes",
            ]),
          );
          expect(applied.exitCode).toBe(0);
          expect(applied.stdout).toContain("never persist raw transcripts");
          expect(applied.stdout).toContain("writeback inspect");

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/claude.json"), "utf8"),
          ) as {
            activationMode?: string;
            writeback?: { mode?: string };
          };
          expect(config.activationMode).toBe("global");
          expect(config.writeback?.mode).toBe("selective");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("recommends selective writeback in the interactive fresh-install prompt", async () => {
    const home = await createTempWorkspace("goodmemory-interactive-selective-home");
    const workspace = await createTempWorkspace(
      "goodmemory-interactive-selective-workspace",
    );

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          // All-default interactive answers: the fresh-install writeback
          // question now recommends selective.
          const answers: string[] = [];
          const result = await withCwd(workspace.root, async () =>
            runCLI(
              ["install", "claude", "--user-id", "interactive-user"],
              {
                interactive: true,
                prompt: {
                  ask: async () => answers.shift() ?? "",
                  askSecret: async () => answers.shift() ?? "",
                },
              },
            ),
          );
          expect(result.exitCode).toBe(0);

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/claude.json"), "utf8"),
          ) as { writeback?: { mode?: string } };
          expect(config.writeback?.mode).toBe("selective");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("captures a codex rollout via writeback --from-rollout", async () => {
    const home = await createTempWorkspace("goodmemory-rollout-home");
    const workspace = await createTempWorkspace("goodmemory-rollout-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          await mkdir(join(home.root, ".goodmemory"), { recursive: true });
          await writeFile(
            join(home.root, ".goodmemory/codex.json"),
            JSON.stringify(
              {
                activationMode: "global",
                host: "codex",
                maxTokens: 256,
                retrievalProfile: "coding_agent",
                storage: {
                  path: join(home.root, ".goodmemory/memory.sqlite"),
                  provider: "sqlite",
                },
                userId: "rollout-user",
                version: 1,
                writeback: { mode: "selective" },
              },
              null,
              2,
            ) + "\n",
            "utf8",
          );

          // Nested sessions layout with two rollouts; --from-rollout picks
          // the newest by mtime.
          const sessionsRoot = join(home.root, ".codex/sessions/2026/07/05");
          await mkdir(sessionsRoot, { recursive: true });
          const oldRollout = join(
            sessionsRoot,
            "rollout-2026-07-05T09-00-00-11111111-1111-1111-1111-111111111111.jsonl",
          );
          const newRollout = join(
            sessionsRoot,
            "rollout-2026-07-05T10-00-00-22222222-2222-2222-2222-222222222222.jsonl",
          );
          const rolloutLine = (text: string) =>
            JSON.stringify({
              payload: {
                content: [{ text, type: "input_text" }],
                role: "user",
                type: "message",
              },
              timestamp: "2026-07-05T10:00:00.000Z",
              type: "response_item",
            }) + "\n";
          await writeFile(oldRollout, rolloutLine("Old rollout decision noted."), "utf8");
          await writeFile(
            newRollout,
            rolloutLine("Next step is to publish the codex rollout capture."),
            "utf8",
          );
          const future = new Date(Date.now() + 5_000);
          const { utimes } = await import("node:fs/promises");
          await utimes(newRollout, future, future);

          const result = await withCwd(workspace.root, async () =>
            runCLI([
              "codex",
              "writeback",
              "--from-rollout",
              "--sessions-root",
              join(home.root, ".codex/sessions"),
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(result.exitCode).toBe(0);
          const payload = JSON.parse(result.stdout) as {
            reason: string;
            trace: Record<string, unknown>;
            wrote: boolean;
          };
          expect(payload.reason).toBe("written");
          expect(payload.wrote).toBe(true);
          expect(payload.trace.transcriptPathUsed).toBe(true);
          expect(payload.trace.transcriptSessionDigest).toMatch(
            /^session:[a-f0-9]{24}$/u,
          );

          // Second run: the cursor makes it a no-op instead of a duplicate.
          const second = await withCwd(workspace.root, async () =>
            runCLI([
              "codex",
              "writeback",
              "--from-rollout",
              "--sessions-root",
              join(home.root, ".codex/sessions"),
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          const secondPayload = JSON.parse(second.stdout) as { reason: string };
          expect(secondPayload.reason).toBe("empty_transcript");

          const missing = await withCwd(workspace.root, async () =>
            runCLI([
              "codex",
              "writeback",
              "--from-rollout",
              "--rollout-path",
              join(sessionsRoot, "missing.jsonl"),
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(missing.exitCode).toBe(1);
          const missingPayload = JSON.parse(missing.stdout) as { reason: string };
          expect(missingPayload.reason).toBe("transcript_read_failed");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("enables the MCP write tool via enable --mcp-allow-write", async () => {
    const home = await createTempWorkspace("goodmemory-mcp-allowwrite-home");
    const workspace = await createTempWorkspace("goodmemory-mcp-allowwrite-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const setup = await withCwd(workspace.root, async () =>
            runCLI([
              "setup",
              "--host",
              "claude",
              "--user-id",
              "allowwrite-user",
              "--json",
            ]),
          );
          expect(setup.exitCode).toBe(0);

          const enable = await withCwd(workspace.root, async () =>
            runCLI([
              "enable",
              "claude",
              "--mcp-allow-write",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(enable.exitCode).toBe(0);

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/claude.json"), "utf8"),
          ) as { mcp?: { allowWrite?: boolean } };
          expect(config.mcp).toEqual({ allowWrite: true });
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("recognizes Codex MCP registration with TOML-spaced managed args", async () => {
    const home = await createTempWorkspace("goodmemory-codex-spaced-mcp-home");
    const workspace = await createTempWorkspace("goodmemory-codex-spaced-mcp-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          await mkdir(join(home.root, ".codex"), { recursive: true });
          await writeFile(
            join(home.root, ".codex/config.toml"),
            [
              "[mcp_servers.goodmemory]",
              'command = "goodmemory-mcp"',
              'args = [ "--host", "codex" ]',
              "",
              "[mcp_servers.goodmemory.env]",
              `GOODMEMORY_HOME = "${home.root}"`,
              'GOODMEMORY_MANAGED_BY = "goodmemory"',
              "",
            ].join("\n"),
            "utf8",
          );

          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--writeback",
            "off",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          const payload = JSON.parse(status.stdout) as {
            hosts: Array<{
              mcpRegistered: boolean;
            }>;
          };
          expect(payload.hosts[0]?.mcpRegistered).toBe(true);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("recognizes the current Codex hooks feature flag as registered", async () => {
    const home = await createTempWorkspace("goodmemory-codex-current-hooks-home");
    const workspace = await createTempWorkspace("goodmemory-codex-current-hooks-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--writeback",
            "off",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const codexConfigPath = join(home.root, ".codex/config.toml");
          const codexConfig = await readFile(codexConfigPath, "utf8");
          await writeFile(
            codexConfigPath,
            codexConfig.replace(/hooks = true[^\n]*/u, "hooks = true"),
            "utf8",
          );

          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          const payload = JSON.parse(status.stdout) as {
            hosts: Array<{
              hookRegistered: boolean;
              preActionRegistered: boolean;
            }>;
          };
          expect(payload.hosts[0]?.hookRegistered).toBe(true);
          expect(payload.hosts[0]?.preActionRegistered).toBe(true);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("repairs a missing Codex hook feature without rewriting installed config", async () => {
    const home = await createTempWorkspace("goodmemory-repair-feature-home");
    const workspace = await createTempWorkspace("goodmemory-repair-feature-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--writeback",
            "off",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const globalConfigPath = join(home.root, ".goodmemory/codex.json");
          const codexConfigPath = join(home.root, ".codex/config.toml");
          const globalConfigBeforeRepair = await readFile(globalConfigPath, "utf8");
          const codexConfig = await readFile(codexConfigPath, "utf8");
          await writeFile(
            codexConfigPath,
            codexConfig
              .split("\n")
              .filter((line) => !line.includes("hooks"))
              .join("\n"),
            "utf8",
          );

          const doctor = await withCwd(workspace.root, async () =>
            runCLI([
              "doctor",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(doctor.exitCode).toBe(0);
          const doctorPayload = JSON.parse(doctor.stdout) as {
            hosts: Array<{
              hookRegistered: boolean;
              mcpRegistered: boolean;
              nextCommands: string[];
              preActionRegistered: boolean;
              repairable: boolean;
            }>;
          };
          expect(doctorPayload.hosts[0]?.hookRegistered).toBe(false);
          expect(doctorPayload.hosts[0]?.mcpRegistered).toBe(true);
          expect(doctorPayload.hosts[0]?.preActionRegistered).toBe(true);
          expect(doctorPayload.hosts[0]?.repairable).toBe(true);
          expect(doctorPayload.hosts[0]?.nextCommands).toContain(
            "goodmemory repair codex",
          );

          const repair = await withCwd(workspace.root, async () =>
            runCLI([
              "repair",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(repair.exitCode).toBe(0);
          const repairedConfig = await readFile(codexConfigPath, "utf8");
          expect(repairedConfig).toContain("hooks = true");
          await expect(readFile(globalConfigPath, "utf8")).resolves.toBe(
            globalConfigBeforeRepair,
          );

          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          const statusPayload = JSON.parse(status.stdout) as {
            hosts: Array<{
              hookRegistered: boolean;
              mcpRegistered: boolean;
              preActionRegistered: boolean;
            }>;
          };
          expect(statusPayload.hosts[0]?.hookRegistered).toBe(true);
          expect(statusPayload.hosts[0]?.mcpRegistered).toBe(true);
          expect(statusPayload.hosts[0]?.preActionRegistered).toBe(true);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("requires manual repair when Codex hook feature is explicitly disabled", async () => {
    const home = await createTempWorkspace("goodmemory-repair-disabled-feature-home");
    const workspace = await createTempWorkspace(
      "goodmemory-repair-disabled-feature-workspace",
    );

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--writeback",
            "off",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const codexConfigPath = join(home.root, ".codex/config.toml");
          const codexConfig = await readFile(codexConfigPath, "utf8");
          await writeFile(
            codexConfigPath,
            codexConfig.replace(/hooks = true[^\n]*/u, "hooks = false"),
            "utf8",
          );

          const doctor = await withCwd(workspace.root, async () =>
            runCLI([
              "doctor",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(doctor.exitCode).toBe(0);
          const doctorPayload = JSON.parse(doctor.stdout) as {
            hosts: Array<{
              nextCommands: string[];
              repairable: boolean;
              warnings: string[];
            }>;
          };
          expect(doctorPayload.hosts[0]?.repairable).toBe(false);
          expect(doctorPayload.hosts[0]?.nextCommands).not.toContain(
            "goodmemory repair codex",
          );
          expect(doctorPayload.hosts[0]?.warnings.join("\n")).toContain(
            "hooks",
          );

          const repair = await withCwd(workspace.root, async () =>
            runCLI([
              "repair",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(repair.exitCode).toBe(1);
          const repairPayload = JSON.parse(repair.stdout) as {
            hosts: Array<{
              skipped: boolean;
              skippedReason: string;
            }>;
          };
          expect(repairPayload.hosts[0]?.skipped).toBe(true);
          expect(repairPayload.hosts[0]?.skippedReason).toBe("manual_fix_required");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("setup installs both hosts with global activation and selective writeback", async () => {
    const home = await createTempWorkspace("goodmemory-setup-home");
    const workspace = await createTempWorkspace("goodmemory-setup-workspace");
    const answers = [
      "both",
      "global",
      "",
      "sqlite",
      "no",
      "no",
      "selective",
      "selective",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI(
              [
                "setup",
                "--interactive",
                "--json",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => answers.shift() ?? "",
                  askSecret: async () => answers.shift() ?? "",
                },
              },
            ),
          );

          expect(result.exitCode).toBe(0);
          const payload = JSON.parse(result.stdout) as {
            hosts: Array<{
              activationMode: string;
              host: string;
              writeback: { mode: string };
            }>;
          };
          expect(payload.hosts.map((host) => host.host).sort()).toEqual(["claude", "codex"]);
          expect(payload.hosts.every((host) => host.activationMode === "global")).toBe(true);
          expect(payload.hosts.every((host) => host.writeback.mode === "selective")).toBe(true);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("shows provider configuration in setup human output", async () => {
    const home = await createTempWorkspace("goodmemory-setup-provider-output-home");
    const workspace = await createTempWorkspace("goodmemory-setup-provider-output-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI([
              "setup",
              "--host",
              "codex",
              "--writeback",
              "observe",
              "--no-interactive",
              "--embedding-provider",
              "openai",
              "--embedding-model",
              "openai/text-embedding-3-small",
              "--embedding-api-key",
              "embedding-secret",
              "--embedding-base-url",
              "https://embeddings.example/v1",
              "--llm-provider",
              "openai",
              "--llm-model",
              "openai/gpt-4o-mini",
              "--llm-api-key",
              "llm-secret",
              "--llm-base-url",
              "https://llm.example/v1",
            ]),
          );

          expect(result.exitCode).toBe(0);
          expect(result.stdout).not.toContain("embedding-secret");
          expect(result.stdout).not.toContain("llm-secret");
          expect(result.stdout).toContain(
            "embedding provider: openai/text-embedding-3-small / custom base URL",
          );
          expect(result.stdout).toContain(
            "LLM extraction provider: openai/gpt-4o-mini / custom base URL",
          );
          expect(result.stdout).not.toContain("openai / openai/");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("uses selective for new interactive setup when the prompt default is accepted", async () => {
    const home = await createTempWorkspace("goodmemory-setup-default-writeback-home");
    const workspace = await createTempWorkspace(
      "goodmemory-setup-default-writeback-workspace",
    );
    const answers = [
      "codex",
      "global",
      "",
      "",
      "",
      "",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI(
              [
                "setup",
                "--interactive",
                "--json",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => answers.shift() ?? "",
                  askSecret: async () => answers.shift() ?? "",
                },
              },
            ),
          );

          expect(result.exitCode).toBe(0);
          const payload = JSON.parse(result.stdout) as {
            hosts: Array<{
              host: string;
              writeback: { mode: string };
            }>;
          };
          expect(payload.hosts).toHaveLength(1);
          expect(payload.hosts[0]?.host).toBe("codex");
          expect(payload.hosts[0]?.writeback.mode).toBe("selective");

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            writeback: { mode: string };
          };
          expect(config.writeback.mode).toBe("selective");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("keeps existing interactive install writeback mode when the prompt default is accepted", async () => {
    const home = await createTempWorkspace("goodmemory-install-keep-writeback-home");
    const prompts: string[] = [];
    const answers = [
      "global",
      "",
      "sqlite",
      "no",
      "no",
      "",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const initial = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--writeback",
            "off",
            "--json",
          ]);
          expect(initial.exitCode).toBe(0);

          const rerun = await runCLI(
            [
              "install",
              "codex",
              "--interactive",
              "--json",
            ],
            {
              interactive: true,
              prompt: {
                ask: async (message) => {
                  prompts.push(message);
                  return answers.shift() ?? "";
                },
                askSecret: async (message) => {
                  prompts.push(message);
                  return answers.shift() ?? "";
                },
              },
            },
          );

          expect(rerun.exitCode).toBe(0);
          expect(prompts.join("\n")).toContain("current=off");
          expect(prompts.join("\n")).toContain("keep-current");
          expect(prompts.join("\n")).toContain("review");
          const payload = JSON.parse(rerun.stdout) as {
            writeback: { mode: string };
          };
          expect(payload.writeback.mode).toBe("off");
          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            writeback: { mode: string };
          };
          expect(config.writeback.mode).toBe("off");
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("setup current-workspace uses workspace opt-in activation while enabling the repo", async () => {
    const home = await createTempWorkspace("goodmemory-setup-current-workspace-home");
    const workspace = await createTempWorkspace("goodmemory-setup-current-workspace");
    const answers = [
      "codex",
      "current-workspace",
      "",
      "sqlite",
      "no",
      "no",
      "off",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI(
              [
                "setup",
                "--interactive",
                "--json",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => answers.shift() ?? "",
                  askSecret: async () => answers.shift() ?? "",
                },
              },
            ),
          );

          expect(result.exitCode).toBe(0);
          const payload = JSON.parse(result.stdout) as {
            hosts: Array<{
              activationMode: string;
              host: string;
              workspaceRoot?: string;
            }>;
          };
          expect(payload.hosts).toHaveLength(1);
          expect(payload.hosts[0]?.host).toBe("codex");
          expect(payload.hosts[0]?.activationMode).toBe("workspace_opt_in");
          expect(await realpath(payload.hosts[0]?.workspaceRoot ?? "")).toBe(
            await realpath(workspace.root),
          );

          const globalConfig = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            activationMode: string;
          };
          const workspaceConfig = JSON.parse(
            await readFile(join(workspace.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            enabled: boolean;
          };
          expect(globalConfig.activationMode).toBe("workspace_opt_in");
          expect(workspaceConfig.enabled).toBe(true);
          expect(await readFile(join(workspace.root, "AGENTS.md"), "utf8")).toContain(
            "GOODMEMORY-INSTALL:CODEX START",
          );
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("rolls back earlier host installs when setup fails on a later workspace enable", async () => {
    const home = await createTempWorkspace("goodmemory-setup-rollback-home");
    const workspace = await createTempWorkspace("goodmemory-setup-rollback-workspace");
    const answers = [
      "both",
      "current-workspace",
      "",
      "sqlite",
      "no",
      "no",
      "off",
    ];

    try {
      await writeFile(
        join(workspace.root, "CLAUDE.md"),
        [
          "# Existing Claude Notes",
          "<!-- GOODMEMORY-INSTALL:CLAUDE START -->",
          "broken block",
        ].join("\n"),
        "utf8",
      );

      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI(
              [
                "setup",
                "--interactive",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => answers.shift() ?? "",
                  askSecret: async () => answers.shift() ?? "",
                },
              },
            ),
          );

          expect(result.exitCode).toBe(1);
          expect(result.stderr).toContain("managed install block is malformed");
          await expect(access(join(home.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".goodmemory/claude.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".codex/hooks.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".codex/config.toml"))).rejects.toThrow();
          await expect(access(join(home.root, ".claude/settings.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".claude.json"))).rejects.toThrow();
          await expect(access(join(workspace.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(access(join(workspace.root, ".goodmemory/claude.json"))).rejects.toThrow();
          await expect(access(join(workspace.root, "AGENTS.md"))).rejects.toThrow();
          expect(await readFile(join(workspace.root, "CLAUDE.md"), "utf8")).toContain(
            "broken block",
          );
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("status does not report user-owned host config files as managed registrations", async () => {
    const home = await createTempWorkspace("goodmemory-status-user-owned-home");
    const workspace = await createTempWorkspace("goodmemory-status-user-owned-workspace");
    const memoryPath = join(home.root, ".goodmemory/memory.sqlite");

    try {
      await mkdir(join(home.root, ".goodmemory"), { recursive: true });
      await mkdir(join(home.root, ".codex"), { recursive: true });
      await writeFile(
        join(home.root, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            activationMode: "global",
            host: "codex",
            storage: {
              path: memoryPath,
              provider: "sqlite",
            },
            userId: "codex-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(home.root, ".codex/hooks.json"),
        JSON.stringify(
          {
            hooks: {
              SessionStart: [],
            },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(home.root, ".codex/config.toml"),
        ["[features]", "hooks = true", ""].join("\n"),
        "utf8",
      );

      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(status.exitCode).toBe(0);
          const payload = JSON.parse(status.stdout) as {
            hosts: Array<{
              hookRegistered: boolean;
              mcpRegistered: boolean;
              preActionRegistered: boolean;
            }>;
          };
          expect(payload.hosts[0]?.hookRegistered).toBe(false);
          expect(payload.hosts[0]?.mcpRegistered).toBe(false);
          expect(payload.hosts[0]?.preActionRegistered).toBe(false);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("status text does not report invalid contextMode as fragment", async () => {
    const home = await createTempWorkspace("goodmemory-status-invalid-context-home");
    const workspace = await createTempWorkspace("goodmemory-status-invalid-context-workspace");

    try {
      await mkdir(join(home.root, ".goodmemory"), { recursive: true });
      await writeFile(
        join(home.root, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            contextMode: "bad",
            host: "codex",
            storage: {
              path: join(home.root, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "codex-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
            ]),
          );

          expect(status.exitCode).toBe(0);
          expect(status.stdout).toContain("  - context: unknown");
          expect(status.stdout).not.toContain("  - context: fragment");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("status does not create a fresh sqlite database for an installed host", async () => {
    const home = await createTempWorkspace("goodmemory-status-fresh-sqlite-home");
    const workspace = await createTempWorkspace("goodmemory-status-fresh-sqlite-workspace");
    const memoryPath = join(home.root, ".goodmemory/memory.sqlite");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
          await expect(access(memoryPath)).rejects.toThrow();

          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(status.exitCode).toBe(0);
          const payload = JSON.parse(status.stdout) as {
            hosts: Array<{
              counts: Record<string, number>;
              memoryStatus: string;
            }>;
          };
          expect(payload.hosts[0]?.memoryStatus).toBe("uninitialized");
          expect(payload.hosts[0]?.counts).toEqual({
            archives: 0,
            episodes: 0,
            facts: 0,
            feedback: 0,
            preferences: 0,
            profile: 0,
            references: 0,
          });
          await expect(access(memoryPath)).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("status reports installed host activation and current workspace counts", async () => {
    const home = await createTempWorkspace("goodmemory-status-home");
    const workspace = await createTempWorkspace("goodmemory-status-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--context-mode",
            "progressive",
            "--writeback",
            "selective",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const remember = await withCwd(workspace.root, async () =>
            runCLI([
              "remember",
              "--host",
              "codex",
              "--workspace-root",
              workspace.root,
              "--message",
              "Remember that release status updates should be short.",
              "--json",
            ]),
          );
          expect(remember.exitCode).toBe(0);

          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(status.exitCode).toBe(0);
          const payload = JSON.parse(status.stdout) as {
            hosts: Array<{
              activationMode: string;
              contextMode: string;
              counts: { facts: number; feedback: number; preferences: number };
              hookRegistered: boolean;
              mcpRegistered: boolean;
              preActionRegistered: boolean;
              workspaceStatus: string;
              writeback: { mode: string };
            }>;
          };
          expect(payload.hosts[0]?.activationMode).toBe("global");
          expect(payload.hosts[0]?.contextMode).toBe("progressive");
          expect(payload.hosts[0]?.writeback.mode).toBe("selective");
          expect(payload.hosts[0]?.hookRegistered).toBe(true);
          expect(payload.hosts[0]?.mcpRegistered).toBe(true);
          expect(payload.hosts[0]?.preActionRegistered).toBe(true);
          expect(payload.hosts[0]?.workspaceStatus).toBe("ok");
          expect(
            (payload.hosts[0]?.counts.facts ?? 0) +
              (payload.hosts[0]?.counts.feedback ?? 0) +
              (payload.hosts[0]?.counts.preferences ?? 0),
          ).toBeGreaterThan(0);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("status reports missing repo opt-in when workspace activation is still manual", async () => {
    const home = await createTempWorkspace("goodmemory-status-manual-home");
    const workspace = await createTempWorkspace("goodmemory-status-manual-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(status.exitCode).toBe(0);
          const payload = JSON.parse(status.stdout) as {
            hosts: Array<{
              activationMode: string;
              counts?: unknown;
              workspaceStatus: string;
            }>;
          };
          expect(payload.hosts[0]?.activationMode).toBe("workspace_opt_in");
          expect(payload.hosts[0]?.workspaceStatus).toBe("missing_repo_config");
          expect(payload.hosts[0]?.counts).toBeUndefined();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("lets interactive sqlite storage override an existing Postgres install", async () => {
    const home = await createTempWorkspace(
      "goodmemory-codex-install-interactive-sqlite-reinstall-home",
    );
    const answers = [
      "",
      "",
      "sqlite",
      "no",
      "no",
      "off",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const initial = await runCLI([
            "install",
            "codex",
            "--storage-provider",
            "postgres",
            "--storage-url",
            "postgres://example/db",
            "--json",
          ]);
          expect(initial.exitCode).toBe(0);

          const result = await runCLI(
            [
              "install",
              "codex",
              "--interactive",
            ],
            {
              interactive: true,
              prompt: {
                ask: async () => answers.shift() ?? "",
                askSecret: async () => answers.shift() ?? "",
              },
            },
          );

          expect(result.exitCode).toBe(0);
          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            storage: {
              path: string;
              provider: string;
            };
          };
          expect(config.storage).toEqual({
            path: join(home.root, ".goodmemory/memory.sqlite"),
            provider: "sqlite",
          });
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("lets interactive users leave a prompted Postgres URL blank to skip Postgres", async () => {
    const home = await createTempWorkspace(
      "goodmemory-codex-install-interactive-blank-postgres-url-home",
    );
    const answers = [
      "",
      "",
      "",
      "no",
      "no",
      "off",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await runCLI(
            [
              "install",
              "codex",
              "--storage-provider",
              "postgres",
              "--interactive",
            ],
            {
              interactive: true,
              prompt: {
                ask: async () => answers.shift() ?? "",
                askSecret: async () => answers.shift() ?? "",
              },
            },
          );

          expect(result.exitCode).toBe(0);
          expect(result.stderr).toBe("");
          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            storage: {
              path: string;
              provider: string;
            };
          };
          expect(config.storage).toEqual({
            path: join(home.root, ".goodmemory/memory.sqlite"),
            provider: "sqlite",
          });
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("rejects blank normalized installed provider flags before writing config", async () => {
    const cases = [
      {
        args: [
          "--embedding-provider",
          "openai",
          "--embedding-model",
          " ",
          "--embedding-api-key",
          "embedding-secret",
        ],
        message: "Incomplete embedding provider config. Missing --embedding-model.",
        prefix: "goodmemory-codex-install-blank-embedding-model",
      },
      {
        args: [
          "--llm-provider",
          "openai",
          "--llm-model",
          "gpt-4o-mini",
          "--llm-api-key",
          " ",
        ],
        message: "Incomplete LLM provider config. Missing --llm-api-key.",
        prefix: "goodmemory-codex-install-blank-llm-key",
      },
    ];

    for (const testCase of cases) {
      const home = await createTempWorkspace(testCase.prefix);

      try {
        await withEnv(
          {
            GOODMEMORY_HOME: home.root,
          },
          async () => {
            const result = await runCLI([
              "install",
              "codex",
              ...testCase.args,
              "--json",
            ]);

            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain(testCase.message);
            await expect(
              access(join(home.root, ".goodmemory/codex.json")),
            ).rejects.toThrow();
          },
        );
      } finally {
        await home.cleanup();
      }
    }
  });

  it("requires a matching global install before enabling repo-local opt-in", async () => {
    const home = await createTempWorkspace("goodmemory-codex-enable-home");
    const workspace = await createTempWorkspace("goodmemory-codex-enable-missing-install");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await runCLI([
            "enable",
            "codex",
            "--workspace-root",
            workspace.root,
            "--json",
          ]);

          expect(result.exitCode).toBe(1);
          expect(result.stderr).toContain("Run 'goodmemory install codex' first");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("enables and disables Codex repo opt-in without losing existing repo notes", async () => {
    const home = await createTempWorkspace("goodmemory-codex-enable-home");
    const workspace = await createTempWorkspace("goodmemory-codex-enable");
    const originalInstructions = "\n# Existing Notes\n\n";

    try {
      await writeFile(join(workspace.root, "AGENTS.md"), originalInstructions, "utf8");

      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const first = await runCLI([
            "enable",
            "codex",
            "--workspace-id",
            "codex-workspace",
            "--workspace-root",
            workspace.root,
            "--json",
          ]);
          expect(first.exitCode).toBe(0);
          const firstPayload = JSON.parse(first.stdout) as {
            changes: Array<{
              action: "created" | "unchanged" | "updated";
              relativePath: string;
            }>;
            host: string;
            workspaceId: string;
          };
          expect(firstPayload.host).toBe("codex");
          expect(firstPayload.workspaceId).toBe("codex-workspace");
          expect(
            firstPayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            { action: "created", relativePath: ".goodmemory/codex.json" },
            { action: "updated", relativePath: "AGENTS.md" },
          ]);

          const firstConfig = JSON.parse(
            await readFile(join(workspace.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            enabled: boolean;
            workspaceId: string;
          };
          expect(firstConfig.enabled).toBe(true);
          expect(firstConfig.workspaceId).toBe("codex-workspace");
          expect(await readFile(join(workspace.root, "AGENTS.md"), "utf8")).toContain(
            "GOODMEMORY-INSTALL:CODEX START",
          );

          const second = await runCLI([
            "enable",
            "codex",
            "--workspace-id",
            "codex-workspace",
            "--workspace-root",
            workspace.root,
            "--json",
          ]);
          expect(second.exitCode).toBe(0);
          const secondPayload = JSON.parse(second.stdout) as {
            changes: Array<{
              action: "created" | "unchanged" | "updated";
              relativePath: string;
            }>;
          };
          expect(
            secondPayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            { action: "unchanged", relativePath: ".goodmemory/codex.json" },
            { action: "unchanged", relativePath: "AGENTS.md" },
          ]);

          const disable = await runCLI([
            "disable",
            "codex",
            "--workspace-root",
            workspace.root,
            "--json",
          ]);
          expect(disable.exitCode).toBe(0);
          const disablePayload = JSON.parse(disable.stdout) as {
            changes: Array<{
              action: "deleted" | "unchanged" | "updated";
              relativePath: string;
            }>;
          };
          expect(
            disablePayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            { action: "updated", relativePath: ".goodmemory/codex.json" },
            { action: "updated", relativePath: "AGENTS.md" },
          ]);
          const disabledConfig = JSON.parse(
            await readFile(join(workspace.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            enabled: boolean;
            workspaceId: string;
          };
          expect(disabledConfig.enabled).toBe(false);
          expect(disabledConfig.workspaceId).toBe("codex-workspace");
          expect(await readFile(join(workspace.root, "AGENTS.md"), "utf8")).toBe(
            originalInstructions,
          );
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("can opt a Codex workspace into observe writeback during enable", async () => {
    const home = await createTempWorkspace("goodmemory-codex-enable-writeback-home");
    const workspace = await createTempWorkspace("goodmemory-codex-enable-writeback");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const enabled = await runCLI([
            "enable",
            "codex",
            "--workspace-root",
            workspace.root,
            "--writeback",
            "observe",
            "--json",
          ]);
          expect(enabled.exitCode).toBe(0);
          const payload = JSON.parse(enabled.stdout) as {
            writeback: { mode: string };
          };
          expect(payload.writeback.mode).toBe("observe");

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            writeback: { mode: string };
          };
          expect(config.writeback.mode).toBe("observe");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("surfaces review writeback mode as an inspector approval queue", async () => {
    const home = await createTempWorkspace("goodmemory-codex-enable-review-home");
    const workspace = await createTempWorkspace("goodmemory-codex-enable-review");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const enabled = await runCLI([
            "enable",
            "codex",
            "--workspace-root",
            workspace.root,
            "--writeback",
            "review",
          ]);
          expect(enabled.exitCode).toBe(0);
          expect(enabled.stdout).toContain("writeback: review");
          expect(enabled.stdout).toContain("Inspector approval queue");
          expect(enabled.stdout).not.toContain("durable remember writeback");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("installs Claude global config and keeps disable/uninstall parity", async () => {
    const home = await createTempWorkspace("goodmemory-claude-install-home");
    const workspace = await createTempWorkspace("goodmemory-claude-enable");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "claude",
            "--user-id",
            "claude-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
          const installPayload = JSON.parse(install.stdout) as {
            changes: Array<{
              action: "created" | "unchanged" | "updated";
              relativePath: string;
            }>;
            host: string;
          };
          expect(installPayload.host).toBe("claude");
          expect(
            installPayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            {
              action: "created",
              relativePath: "claude.json",
            },
            {
              action: "created",
              relativePath: ".claude.json",
            },
            {
              action: "created",
              relativePath: ".claude/settings.json",
            },
          ]);
          expect(
            await readFile(join(home.root, ".claude/settings.json"), "utf8"),
          ).toContain("UserPromptSubmit");
        },
      );
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const enable = await runCLI([
            "enable",
            "claude",
            "--workspace-root",
            workspace.root,
            "--json",
          ]);
          expect(enable.exitCode).toBe(0);
          const enablePayload = JSON.parse(enable.stdout) as {
            changes: Array<{
              action: "created" | "unchanged" | "updated";
              relativePath: string;
            }>;
            host: string;
          };
          expect(enablePayload.host).toBe("claude");
          expect(
            enablePayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            { action: "created", relativePath: ".goodmemory/claude.json" },
            { action: "created", relativePath: "CLAUDE.md" },
          ]);
          expect(await readFile(join(workspace.root, "CLAUDE.md"), "utf8")).toContain(
            "GOODMEMORY-INSTALL:CLAUDE START",
          );

          const disable = await runCLI([
            "disable",
            "claude",
            "--workspace-root",
            workspace.root,
            "--json",
          ]);
          expect(disable.exitCode).toBe(0);
          const disablePayload = JSON.parse(disable.stdout) as {
            changes: Array<{
              action: "deleted" | "unchanged" | "updated";
              relativePath: string;
            }>;
          };
          expect(
            disablePayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            { action: "updated", relativePath: ".goodmemory/claude.json" },
            { action: "deleted", relativePath: "CLAUDE.md" },
          ]);

          const uninstall = await runCLI(["uninstall", "claude", "--json"]);
          expect(uninstall.exitCode).toBe(0);
          const uninstallPayload = JSON.parse(uninstall.stdout) as {
            changes: Array<{
              action: "deleted" | "unchanged" | "updated";
              relativePath: string;
            }>;
          };
          expect(
            uninstallPayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            { action: "deleted", relativePath: "claude.json" },
            { action: "deleted", relativePath: ".claude/settings.json" },
            { action: "deleted", relativePath: ".claude.json" },
          ]);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("runs the Codex user-prompt-submit hook and emits additionalContext JSON", async () => {
    const home = await createTempWorkspace("goodmemory-codex-hook-home");
    const workspace = await createTempWorkspace("goodmemory-codex-hook-runtime");
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");

    try {
      await mkdir(join(home.root, ".goodmemory"), { recursive: true });
      await mkdir(join(workspace.root, ".goodmemory"), { recursive: true });
      await writeFile(
        join(home.root, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            debug: false,
            host: "codex",
            maxTokens: 512,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(home.root, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "cli-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(workspace.root, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            enabled: true,
            host: "codex",
            version: 1,
            workspaceId: "workspace-a",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await seedSQLiteMemory(join(home.root, ".goodmemory/memory.sqlite"));

      const result = await runBunScript({
        args: ["codex", "hook", "user-prompt-submit"],
        cwd: workspace.root,
        env: {
          GOODMEMORY_HOME: home.root,
        },
        scriptPath: cliScript,
        stdin: JSON.stringify({
          cwd: workspace.root,
          hook_event_name: "UserPromptSubmit",
          prompt: "Check the release runbook before editing files.",
          session_id: "hook-session-1",
          turn_id: "turn-hook-1",
        }),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");
      const payload = JSON.parse(result.stdout) as {
        hookSpecificOutput: {
          additionalContext: string;
          hookEventName: string;
        };
      };
      expect(payload.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
      expect(payload.hookSpecificOutput.additionalContext).toContain(
        "Developer memory notes",
      );
      expect(payload.hookSpecificOutput.additionalContext).toContain(
        "release quality program",
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("runs the Codex pre-tool-use hook and routes risky Bash commands to the installed action bridge", async () => {
    const home = await createTempWorkspace("goodmemory-codex-pretool-hook-home");
    const workspace = await createTempWorkspace("goodmemory-codex-pretool-hook-runtime");
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "cli-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const enable = await withCwd(workspace.root, async () =>
            runCLI([
              "enable",
              "codex",
              "--workspace-root",
              workspace.root,
              "--workspace-id",
              "workspace-a",
              "--json",
            ]),
          );
          expect(enable.exitCode).toBe(0);
        },
      );

      await seedCodexActionPolicyMemory({
        sqlitePath: join(home.root, ".goodmemory/memory.sqlite"),
        sessionId: "hook-session-1",
        userId: "cli-user",
        workspaceId: "workspace-a",
        rule: "Rather than DeepAnalyzer, use QuickCheck first.",
        evidenceExcerpt:
          "DeepAnalyzer detailed scan failed because QuickCheck had not run first.",
      });

      const result = await runBunScript({
        args: ["codex", "hook", "pre-tool-use"],
        cwd: workspace.root,
        env: {
          GOODMEMORY_HOME: home.root,
        },
        scriptPath: cliScript,
        stdin: JSON.stringify({
          cwd: workspace.root,
          hook_event_name: "PreToolUse",
          sequence: 3,
          session_id: "hook-session-1",
          tool_input: {
            command: "./tools/DeepAnalyzer --detailed",
          },
          tool_name: "Bash",
          turn_id: "turn-hook-1",
        }),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");
      const payload = JSON.parse(result.stdout) as {
        hookSpecificOutput: {
          hookEventName: string;
          permissionDecision: string;
          permissionDecisionReason: string;
        };
      };
      expect(payload.hookSpecificOutput.hookEventName).toBe("PreToolUse");
      expect(payload.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(payload.hookSpecificOutput.permissionDecisionReason).toContain(
        "goodmemory codex action",
      );
      expect(payload.hookSpecificOutput.permissionDecisionReason).toContain(
        "--action-id",
      );
      expect(payload.hookSpecificOutput.permissionDecisionReason).toContain(
        "DeepAnalyzer --detailed",
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("runs the installed Codex action bridge, rewrites DeepAnalyzer, and records lineage in installed storage", async () => {
    const home = await createTempWorkspace("goodmemory-codex-installed-action-home");
    const workspace = await createTempWorkspace("goodmemory-codex-installed-action-runtime");
    const sqlitePath = join(home.root, ".goodmemory/memory.sqlite");
    const toolsDir = join(workspace.root, "tools");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "cli-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const enable = await withCwd(workspace.root, async () =>
            runCLI([
              "enable",
              "codex",
              "--workspace-root",
              workspace.root,
              "--workspace-id",
              "workspace-a",
              "--json",
            ]),
          );
          expect(enable.exitCode).toBe(0);
        },
      );

      const { memory, scope } = await seedCodexActionPolicyMemory({
        sqlitePath,
        sessionId: "action-session-1",
        userId: "cli-user",
        workspaceId: "workspace-a",
        rule: "Rather than DeepAnalyzer, use QuickCheck first.",
        evidenceExcerpt:
          "DeepAnalyzer detailed scan failed because QuickCheck had not run first.",
      });

      await mkdir(toolsDir, { recursive: true });
      await writeFile(
        join(toolsDir, "QuickCheck"),
        [
          "#!/usr/bin/env sh",
          `echo quickcheck >> ${JSON.stringify(join(workspace.root, "quickcheck.log"))}`,
        ].join("\n"),
        "utf8",
      );
      await chmod(join(toolsDir, "QuickCheck"), 0o755);
      await writeFile(
        join(toolsDir, "DeepAnalyzer"),
        [
          "#!/usr/bin/env sh",
          `echo deepanalyzer >> ${JSON.stringify(join(workspace.root, "deepanalyzer.log"))}`,
        ].join("\n"),
        "utf8",
      );
      await chmod(join(toolsDir, "DeepAnalyzer"), 0o755);

      const result = await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () =>
          withCwd(workspace.root, async () =>
            runCLI([
              "codex",
              "action",
              "--session-id",
              "action-session-1",
              "--turn-id",
              "turn-action-1",
              "--command",
              "./tools/DeepAnalyzer --detailed",
              "--json",
            ]),
          ),
      );

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        actionId: string;
        decision: string;
        executed: boolean;
        executedStep: string;
        originalActionDeferred: boolean;
        realizedEventParentId: string;
        rewritten: boolean;
      };
      expect(payload.decision).toBe("review_required");
      expect(payload.executed).toBe(true);
      expect(payload.executedStep).toBe("./tools/QuickCheck");
      expect(payload.rewritten).toBe(true);
      expect(payload.originalActionDeferred).toBe(true);
      expect(payload.realizedEventParentId).toBe(payload.actionId);
      const quickCheckExecuted = await access(join(workspace.root, "quickcheck.log"))
        .then(() => true)
        .catch(() => false);
      const deepAnalyzerExecuted = await access(join(workspace.root, "deepanalyzer.log"))
        .then(() => true)
        .catch(() => false);
      expect(quickCheckExecuted).toBe(true);
      expect(deepAnalyzerExecuted).toBe(false);

      const exported = await memory.exportMemory({
        includeRuntime: true,
        scope: {
          ...scope,
          agentId: "codex",
        },
      });
      expect(
        exported.durable.experiences.some(
          (record) => record.traceId === payload.actionId,
        ),
      ).toBe(true);
      expect(
        exported.durable.experiences.some(
          (record) =>
            Array.isArray(record.sourceTraceIds) &&
            record.sourceTraceIds.includes(payload.actionId) &&
            record.traceId !== payload.actionId,
        ),
      ).toBe(true);
      expect(
        exported.durable.evidence.some(
          (record) => record.kind === "tool_result_excerpt",
        ),
      ).toBe(true);
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("preserves literal argv tokens passed after -- for installed Codex actions", async () => {
    const home = await createTempWorkspace("goodmemory-codex-installed-argv-home");
    const workspace = await createTempWorkspace("goodmemory-codex-installed-argv-runtime");
    const capturePath = join(workspace.root, "capture-argv.sh");
    const captureOutputPath = join(workspace.root, "captured-argv.txt");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "cli-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const enable = await withCwd(workspace.root, async () =>
            runCLI([
              "enable",
              "codex",
              "--workspace-root",
              workspace.root,
              "--workspace-id",
              "workspace-a",
              "--json",
            ]),
          );
          expect(enable.exitCode).toBe(0);
        },
      );

      await writeFile(
        capturePath,
        [
          "#!/usr/bin/env sh",
          `printf '%s\\n' \"$@\" > ${JSON.stringify(captureOutputPath)}`,
        ].join("\n"),
        "utf8",
      );
      await chmod(capturePath, 0o755);

      const result = await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () =>
          withCwd(workspace.root, async () =>
            runCLI([
              "codex",
              "action",
              "--session-id",
              "action-session-argv",
              "--",
              "./capture-argv.sh",
              "--flag",
              "two words",
              "semi;colon",
              "quote'and",
            ]),
          ),
      );

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        decision: string;
        executed: boolean;
        executedStep: string;
      };
      expect(payload.decision).toBe("allow");
      expect(payload.executed).toBe(true);
      expect(payload.executedStep).toContain("./capture-argv.sh");
      const captured = await readFile(captureOutputPath, "utf8");
      expect(captured.trim().split("\n")).toEqual([
        "--flag",
        "two words",
        "semi;colon",
        "quote'and",
      ]);
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("blocks destructive installed Codex actions without executing the original command", async () => {
    const home = await createTempWorkspace("goodmemory-codex-installed-block-home");
    const workspace = await createTempWorkspace("goodmemory-codex-installed-block-runtime");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "cli-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const enable = await withCwd(workspace.root, async () =>
            runCLI([
              "enable",
              "codex",
              "--workspace-root",
              workspace.root,
              "--workspace-id",
              "workspace-a",
              "--json",
            ]),
          );
          expect(enable.exitCode).toBe(0);
        },
      );

      await seedCodexActionPolicyMemory({
        sqlitePath: join(home.root, ".goodmemory/memory.sqlite"),
        sessionId: "action-session-2",
        userId: "cli-user",
        workspaceId: "workspace-a",
        rule: "Never delete AGENTS.md from the host bootstrap surface.",
        why: "It breaks repo-local host wiring and package bootstrap continuity.",
        evidenceExcerpt:
          "Deleting AGENTS.md broke the repo-local host bootstrap surface.",
      });
      await writeFile(join(workspace.root, "AGENTS.md"), "# Keep me\n", "utf8");

      const result = await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () =>
          withCwd(workspace.root, async () =>
            runCLI([
              "codex",
              "action",
              "--session-id",
              "action-session-2",
              "--turn-id",
              "turn-action-2",
              "--command",
              "rm -rf AGENTS.md",
              "--json",
            ]),
          ),
      );

      expect(result.exitCode).toBe(2);
      const payload = JSON.parse(result.stdout) as {
        decision: string;
        executed: boolean;
        reason: string;
        rewritten: boolean;
      };
      expect(payload.decision).toBe("blocked");
      expect(payload.executed).toBe(false);
      expect(payload.rewritten).toBe(false);
      expect(payload.reason).toContain("destructive action");
      expect(await readFile(join(workspace.root, "AGENTS.md"), "utf8")).toBe("# Keep me\n");
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("runs the Codex writeback command in observe mode without writing memory", async () => {
    const home = await createTempWorkspace("goodmemory-codex-writeback-home");
    const workspace = await createTempWorkspace("goodmemory-codex-writeback-runtime");
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--user-id",
            "cli-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const result = await runBunScript({
            args: ["codex", "writeback", "--mode", "observe", "--json"],
            cwd: workspace.root,
            env: {
              GOODMEMORY_HOME: home.root,
            },
            scriptPath: cliScript,
            stdin: JSON.stringify({
              cwd: workspace.root,
              messages: [
                {
                  content: "Always run typecheck before closing Phase 37.",
                  role: "user",
                },
              ],
              session_id: "writeback-session-1",
            }),
          });

          expect(result.exitCode).toBe(0);
          const payload = JSON.parse(result.stdout) as {
            candidates: Array<{ content: string; durable: boolean; kind: string }>;
            reason: string;
            trace: { rawTranscriptPersisted: boolean };
            wrote: boolean;
          };
          expect(payload.reason).toBe("observed");
          expect(payload.wrote).toBe(false);
          expect(payload.trace.rawTranscriptPersisted).toBe(false);
          expect(payload.candidates).toEqual([
            expect.objectContaining({
              content: "Always run typecheck before closing Phase 37.",
              durable: true,
              kind: "preference",
            }),
          ]);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("exits nonzero for direct Codex writeback operational failures", async () => {
    const missingConfigHome = await createTempWorkspace(
      "goodmemory-codex-writeback-missing-config-home",
    );
    const missingRepoHome = await createTempWorkspace(
      "goodmemory-codex-writeback-missing-repo-home",
    );
    const writeFailureHome = await createTempWorkspace(
      "goodmemory-codex-writeback-failed-home",
    );
    const auditFailureHome = await createTempWorkspace(
      "goodmemory-codex-writeback-audit-failed-home",
    );
    const workspace = await createTempWorkspace(
      "goodmemory-codex-writeback-failures-workspace",
    );
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");
    const stdin = JSON.stringify({
      cwd: workspace.root,
      messages: [
        {
          content: "Always run typecheck before closing Phase 37.",
          role: "user",
        },
      ],
      session_id: "writeback-session-1",
    });

    try {
      const missingConfig = await runBunScript({
        args: ["codex", "writeback", "--json"],
        cwd: workspace.root,
        env: {
          GOODMEMORY_HOME: missingConfigHome.root,
        },
        scriptPath: cliScript,
        stdin,
      });
      expect(missingConfig.exitCode).toBe(1);
      expect((JSON.parse(missingConfig.stdout) as { reason: string }).reason).toBe(
        "missing_config",
      );

      await withEnv(
        {
          GOODMEMORY_HOME: missingRepoHome.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "workspace_opt_in",
            "--user-id",
            "cli-user",
            "--writeback",
            "selective",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
        },
      );
      const missingRepoOptIn = await runBunScript({
        args: ["codex", "writeback", "--json"],
        cwd: workspace.root,
        env: {
          GOODMEMORY_HOME: missingRepoHome.root,
        },
        scriptPath: cliScript,
        stdin,
      });
      expect(missingRepoOptIn.exitCode).toBe(1);
      expect(
        (JSON.parse(missingRepoOptIn.stdout) as { reason: string }).reason,
      ).toBe("missing_repo_opt_in");

      await withEnv(
        {
          GOODMEMORY_HOME: writeFailureHome.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--user-id",
            "cli-user",
            "--writeback",
            "selective",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
        },
      );
      await writeFile(
        join(writeFailureHome.root, ".goodmemory/codex-writeback-events.json"),
        JSON.stringify({ events: "bad-ledger" }, null, 2) + "\n",
        "utf8",
      );
      const writeFailed = await runBunScript({
        args: ["codex", "writeback", "--json"],
        cwd: workspace.root,
        env: {
          GOODMEMORY_HOME: writeFailureHome.root,
        },
        scriptPath: cliScript,
        stdin,
      });
      expect(writeFailed.exitCode).toBe(1);
      expect((JSON.parse(writeFailed.stdout) as { reason: string }).reason).toBe(
        "write_failed",
      );

      await withEnv(
        {
          GOODMEMORY_HOME: auditFailureHome.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--user-id",
            "cli-user",
            "--writeback",
            "observe",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
        },
      );
      await writeFile(
        join(auditFailureHome.root, ".goodmemory/codex-writeback-events.json"),
        JSON.stringify({ events: "bad-ledger" }, null, 2) + "\n",
        "utf8",
      );
      const auditFailed = await runBunScript({
        args: ["codex", "writeback", "--json"],
        cwd: workspace.root,
        env: {
          GOODMEMORY_HOME: auditFailureHome.root,
        },
        scriptPath: cliScript,
        stdin,
      });
      expect(auditFailed.exitCode).toBe(1);
      expect((JSON.parse(auditFailed.stdout) as { reason: string }).reason).toBe(
        "audit_failed",
      );
    } finally {
      await missingConfigHome.cleanup();
      await missingRepoHome.cleanup();
      await writeFailureHome.cleanup();
      await auditFailureHome.cleanup();
      await workspace.cleanup();
    }
  }, 15_000);

  it("inspects and forgets installed-host writeback audit events for Codex and Claude", async () => {
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");

    for (const host of ["codex", "claude"] as const) {
      const home = await createTempWorkspace(`goodmemory-${host}-writeback-audit-home`);
      const workspace = await createTempWorkspace(
        `goodmemory-${host}-writeback-audit-workspace`,
      );

      try {
        await withEnv(
          {
            GOODMEMORY_HOME: home.root,
          },
          async () => {
            const install = await runCLI([
              "install",
              host,
              "--activation-mode",
              "global",
              "--user-id",
              "cli-user",
              "--writeback",
              "selective",
              "--json",
            ]);
            expect(install.exitCode).toBe(0);
          },
        );

        const writeback = await runBunScript({
          args: [host, "writeback", "--json"],
          cwd: workspace.root,
          env: {
            GOODMEMORY_HOME: home.root,
          },
          scriptPath: cliScript,
          stdin: JSON.stringify({
            cwd: workspace.root,
            messages: [
              {
                content: `Next step is to add Phase 37.1 ${host} CLI audit undo.`,
                role: "user",
              },
            ],
            session_id: `${host}-cli-audit-session-1`,
          }),
        });
        expect(writeback.exitCode).toBe(0);

        const inspect = await runBunScript({
          args: [host, "writeback", "inspect", "--json"],
          cwd: workspace.root,
          env: {
            GOODMEMORY_HOME: home.root,
          },
          scriptPath: cliScript,
        });
        expect(inspect.exitCode).toBe(0);
        const inspectPayload = JSON.parse(inspect.stdout) as {
          events: Array<{
            contentPreview: string;
            eventId: string;
            linkedRecordIds: Array<{ id: string; type: string }>;
            memoryExistsCount: number;
            memoryIds: string[];
            status: string;
          }>;
        };
        expect(inspectPayload.events[0]).toEqual(
          expect.objectContaining({
            contentPreview: expect.stringContaining(
              `Phase 37.1 ${host} CLI audit undo`,
            ),
            linkedRecordIds: expect.arrayContaining([
              expect.objectContaining({ type: "memory" }),
              expect.objectContaining({ type: "evidence" }),
            ]),
            memoryExistsCount: 1,
            status: "committed",
          }),
        );

        const forget = await runBunScript({
          args: [
            host,
            "writeback",
            "forget",
            "--event-id",
            inspectPayload.events[0]!.eventId,
            "--review-outcome",
            "false_write",
            "--review-reason",
            "api_key=sk-cli-review-secret-value",
            "--json",
          ],
          cwd: workspace.root,
          env: {
            GOODMEMORY_HOME: home.root,
          },
          scriptPath: cliScript,
        });
        expect(forget.exitCode).toBe(0);
        const forgetPayload = JSON.parse(forget.stdout) as {
          forgottenLinkedRecordIds: Array<{ id: string; type: string }>;
          forgottenMemoryIds: string[];
          review?: { outcome: string; reason?: string };
          status: string;
        };
        expect(forgetPayload.forgottenLinkedRecordIds).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "memory" }),
            expect.objectContaining({ type: "evidence" }),
          ]),
        );
        expect(forgetPayload.forgottenMemoryIds.length).toBeGreaterThan(0);
        expect(forgetPayload.review).toEqual({
          outcome: "false_write",
          reason: "[redacted secret-like content]",
        });
        expect(forget.stdout).not.toContain("sk-cli-review-secret-value");
        expect(forgetPayload.status).toBe("forgotten");
      } finally {
        await home.cleanup();
        await workspace.cleanup();
      }
    }
  }, 15_000);

  it("runs the Claude session-start hook fail-open with a debug systemMessage when the repo is disabled", async () => {
    const home = await createTempWorkspace("goodmemory-claude-hook-home");
    const workspace = await createTempWorkspace("goodmemory-claude-hook-runtime");
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");

    try {
      await mkdir(join(home.root, ".goodmemory"), { recursive: true });
      await mkdir(join(workspace.root, ".goodmemory"), { recursive: true });
      await writeFile(
        join(home.root, ".goodmemory/claude.json"),
        JSON.stringify(
          {
            debug: true,
            host: "claude",
            maxTokens: 128,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(home.root, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "cli-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(workspace.root, ".goodmemory/claude.json"),
        JSON.stringify(
          {
            debug: true,
            enabled: false,
            host: "claude",
            version: 1,
            workspaceId: "workspace-a",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const result = await runBunScript({
        args: ["claude", "hook", "session-start"],
        cwd: workspace.root,
        env: {
          GOODMEMORY_HOME: home.root,
        },
        scriptPath: cliScript,
        stdin: JSON.stringify({
          cwd: workspace.root,
          hook_event_name: "SessionStart",
          session_id: "hook-session-2",
          source: "startup",
        }),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");
      const payload = JSON.parse(result.stdout) as { systemMessage: string };
      expect(payload.systemMessage).toBe(
        "GoodMemory claude session-start hook skipped: disabled.",
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("fails open when hook stdin is malformed JSON", async () => {
    const workspace = await createTempWorkspace("goodmemory-hook-invalid-stdin");
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");

    try {
      const result = await runBunScript({
        args: ["codex", "hook", "session-start"],
        cwd: workspace.root,
        scriptPath: cliScript,
        stdin: "{invalid",
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("{}");
      expect(result.stderr.trim()).toBe("");
    } finally {
      await workspace.cleanup();
    }
  });

  it("fails open when hook stdin is empty", async () => {
    const workspace = await createTempWorkspace("goodmemory-hook-empty-stdin");
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");

    try {
      const result = await runBunScript({
        args: ["codex", "hook", "session-start"],
        cwd: workspace.root,
        scriptPath: cliScript,
        stdin: "",
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("{}");
      expect(result.stderr.trim()).toBe("");
    } finally {
      await workspace.cleanup();
    }
  });
});

describe("goodmemory cli root commands", () => {
  it("uses a non-mutating postgres probe for read-only auto storage", async () => {
    const calls: string[] = [];

    const storage = await resolveStorageConfig(
      {
        "storage-url": "postgres://localhost:5432/goodmemory",
      },
      {
        readOnlyStorage: true,
      },
      {
        canBootstrapPostgresStorageBackend: async () => {
          calls.push("bootstrap");
          return true;
        },
        probeReadOnlyPostgresStorageBackend: async () => {
          calls.push("read");
          return "readable";
        },
        pathExists: async () => false,
      },
    );

    expect(storage).toEqual({
      provider: "postgres",
      url: "postgres://localhost:5432/goodmemory",
      displayValue: "configured",
    });
    expect(calls).toEqual(["read"]);
  });

  it("uses the bootstrap probe for writable auto postgres resolution", async () => {
    const calls: string[] = [];

    const storage = await resolveStorageConfig(
      {
        "storage-url": "postgres://localhost:5432/goodmemory",
      },
      undefined,
      {
        canBootstrapPostgresStorageBackend: async () => {
          calls.push("bootstrap");
          return true;
        },
        probeReadOnlyPostgresStorageBackend: async () => {
          calls.push("read");
          return "readable";
        },
        mkdir: async () => undefined,
        pathExists: async () => false,
      },
    );

    expect(storage).toEqual({
      provider: "postgres",
      url: "postgres://localhost:5432/goodmemory",
      displayValue: "configured",
    });
    expect(calls).toEqual(["bootstrap"]);
  });

  it("reports read-only postgres probe failures without bootstrapping durable state", async () => {
    await expect(
      resolveStorageConfig(
        {
          "storage-url": "postgres://localhost:5432/goodmemory",
        },
        {
          readOnlyStorage: true,
        },
        {
          canBootstrapPostgresStorageBackend: async () => true,
          probeReadOnlyPostgresStorageBackend: async () => {
            throw new Error("permission denied");
          },
          pathExists: async () => false,
        },
      ),
    ).rejects.toThrow("without mutating durable authority");
  });

  it("fails closed when the read-only postgres probe is inconclusive", async () => {
    const calls: string[] = [];

    await expect(
      resolveStorageConfig(
        {
          "storage-url": "postgres://localhost:5432/goodmemory",
        },
        {
          readOnlyStorage: true,
        },
        {
          canBootstrapPostgresStorageBackend: async () => {
            calls.push("bootstrap");
            return true;
          },
          probeReadOnlyPostgresStorageBackend: async () => {
            calls.push("read");
            return "inconclusive";
          },
          pathExists: async () => {
            calls.push("sqlite");
            return true;
          },
        },
      ),
    ).rejects.toThrow("without mutating durable authority");

    expect(calls).toEqual(["read"]);
  });

  it("allows sqlite fallback when the read-only postgres probe proves postgres is unusable", async () => {
    const calls: string[] = [];

    const storage = await resolveStorageConfig(
      {
        "storage-url": "postgres://localhost:5432/goodmemory",
      },
      {
        readOnlyStorage: true,
      },
      {
        canBootstrapPostgresStorageBackend: async () => {
          calls.push("bootstrap");
          return true;
        },
        probeReadOnlyPostgresStorageBackend: async () => {
          calls.push("read");
          return "unusable";
        },
        pathExists: async () => {
          calls.push("sqlite");
          return true;
        },
      },
    );

    expect(storage.provider).toBe("sqlite");
    expect(calls).toEqual(["read", "sqlite"]);
  });

  it("inspect summarizes scoped memory from sqlite storage", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-inspect");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      await seedSQLiteMemory(sqlitePath);

      const result = await runCLI([
        "inspect",
        "--user-id",
        "cli-user",
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Scope: user=cli-user");
      expect(result.stdout).toContain(`Storage: sqlite (${sqlitePath})`);
      expect(result.stdout).toContain("Profile: present");
      expect(result.stdout).toContain("Top Facts");
      expect(result.stdout).toContain("vendor approval for release quality program");
      expect(result.stdout).toContain("Top References");
      expect(result.stdout).toContain("docs/release-quality-runbook.md");
      expect(result.stdout).toContain("Top Feedback");
      expect(result.stdout).toContain("Use concise bullet points in summaries.");
    } finally {
      await workspace.cleanup();
    }
  });

  it("inspect does not create a vectors table in read-only sqlite mode", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-inspect-read-only");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      await seedSQLiteMemory(sqlitePath);
      dropSQLiteTable(sqlitePath, "vectors");

      expect(hasSQLiteTable(sqlitePath, "vectors")).toBe(false);

      const result = await runCLI([
        "inspect",
        "--user-id",
        "cli-user",
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(hasSQLiteTable(sqlitePath, "vectors")).toBe(false);
    } finally {
      await workspace.cleanup();
    }
  });

  it("inspect hides superseded references from the top summary", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-inspect-superseded");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      const { memory, scope } = await seedSQLiteMemory(sqlitePath);

      await memory.remember({
        scope,
        messages: [
          {
            role: "user",
            content:
              "Correction: docs/release-quality-runbook-v2.md is now the source of truth, not docs/release-quality-runbook.md. Please update that.",
          },
        ],
      });

      const result = await runCLI([
        "inspect",
        "--user-id",
        scope.userId,
        "--workspace-id",
        scope.workspaceId!,
        "--session-id",
        scope.sessionId!,
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Top References");
      expect(result.stdout).toContain("docs/release-quality-runbook-v2.md");
      expect(result.stdout).not.toContain(
        "- release-quality-runbook.md -> docs/release-quality-runbook.md",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("trace uses a non-mutating recall diagnostic path", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-trace");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      const { memory, scope } = await seedSQLiteMemory(sqlitePath);
      const before = await memory.exportMemory({
        scope,
      });
      const blockerFact = before.durable.facts.find((record) =>
        record.content.includes("vendor approval"),
      );
      const feedback = before.durable.feedback.find((record) =>
        record.rule.includes("concise bullet points"),
      );

      const result = await runCLI([
        "trace",
        "--user-id",
        scope.userId,
        "--workspace-id",
        scope.workspaceId!,
        "--session-id",
        scope.sessionId!,
        "--query",
        "Which runbook is the source of truth and what is the blocker?",
        "--strategy",
        "rules-only",
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
      ]);

      const after = await memory.exportMemory({
        scope,
      });
      const blockerFactAfter = after.durable.facts.find((record) =>
        record.content.includes("vendor approval"),
      );
      const feedbackAfter = after.durable.feedback.find((record) =>
        record.rule.includes("concise bullet points"),
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Routing Decision");
      expect(result.stdout).toContain("requested strategy: rules-only");
      expect(result.stdout).toContain("resolved strategy: rules-only");
      expect(result.stdout).toContain("Hits");
      expect(result.stdout).toContain("Returned Candidate Traces");
      expect(result.stdout).toContain("Suppressed Candidate Traces");
      expect(blockerFactAfter?.accessCount).toBe(blockerFact?.accessCount);
      expect(blockerFactAfter?.lastAccessedAt).toBe(blockerFact?.lastAccessedAt);
      expect(feedbackAfter?.lastUsedAt).toBe(feedback?.lastUsedAt);
      expect(after.durable.experiences).toHaveLength(before.durable.experiences.length);
      expect(after.durable.proposals).toHaveLength(before.durable.proposals.length);
      expect(after.durable.promotions).toHaveLength(before.durable.promotions.length);
    } finally {
      await workspace.cleanup();
    }
  });

  it("trace supports ignore-memory for read-only policy diagnostics", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-trace-ignore-memory");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      const { scope } = await seedSQLiteMemory(sqlitePath);

      const result = await runCLI([
        "trace",
        "--user-id",
        scope.userId,
        "--workspace-id",
        scope.workspaceId!,
        "--session-id",
        scope.sessionId!,
        "--query",
        "Which runbook is the source of truth and what is the blocker?",
        "--ignore-memory",
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Storage: memory (ignored (--ignore-memory))");
      expect(result.stdout).toContain("Hits");
      expect(result.stdout).toContain("Returned Candidate Traces");
      expect(result.stdout).toContain("Suppressed Candidate Traces");
      expect(result.stdout).toContain("Policy Applied");
      expect(result.stdout).toContain("- ignore_memory");
      expect(result.stdout).toContain("- none");
    } finally {
      await workspace.cleanup();
    }
  });

  it("trace exposes structured diagnostics with --json", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-trace-json");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      const { scope } = await seedSQLiteMemory(sqlitePath);

      const result = await runCLI([
        "trace",
        "--user-id",
        scope.userId,
        "--workspace-id",
        scope.workspaceId!,
        "--session-id",
        scope.sessionId!,
        "--query",
        "Which runbook is the source of truth and what is the blocker?",
        "--strategy",
        "rules-only",
        "--json",
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
      ]);

      const payload = JSON.parse(result.stdout) as {
        candidateTraceCount: number;
        candidateTraces: unknown[];
        hits: unknown[];
        policyApplied: string[];
        routingDecision: {
          strategy: string;
        };
        verificationHints: unknown[];
      };

      expect(result.exitCode).toBe(0);
      expect(payload.routingDecision.strategy).toBe("rules-only");
      expect(payload.hits.length).toBeGreaterThan(0);
      expect(payload.candidateTraces.length).toBeGreaterThan(0);
      expect(payload.candidateTraceCount).toBe(payload.candidateTraces.length);
      expect(payload.verificationHints.length).toBeGreaterThan(0);
      expect(Array.isArray(payload.policyApplied)).toBe(true);
    } finally {
      await workspace.cleanup();
    }
  });

  it("stats reports scope-bounded counts and backend metadata", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-stats");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      await seedSQLiteMemory(sqlitePath);

      const result = await runCLI([
        "stats",
        "--user-id",
        "cli-user",
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Storage Provider: sqlite");
      expect(result.stdout).toContain(`Storage Location: ${sqlitePath}`);
      expect(result.stdout).toContain("Profile Records: 1");
      expect(result.stdout).toContain("References: 1");
      expect(result.stdout).toContain("Facts: 1");
      expect(result.stdout).toContain("Feedback: 1");
    } finally {
      await workspace.cleanup();
    }
  });

  it("export-memory writes json and markdown artifacts", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-export");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      const { scope } = await seedSQLiteMemory(sqlitePath);
      const outputPath = join(workspace.root, "memory-export");

      const result = await runCLI([
        "export-memory",
        "--user-id",
        scope.userId,
        "--workspace-id",
        scope.workspaceId!,
        "--session-id",
        scope.sessionId!,
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
        "--output",
        outputPath,
      ]);

      const exported = JSON.parse(
        await readFile(join(outputPath, "memory-export.json"), "utf8"),
      ) as { scope: { userId: string } };
      const memoryArtifact = await readFile(
        join(
          outputPath,
          ".goodmemory",
          "users",
          scope.userId,
          "workspaces",
          scope.workspaceId!,
          "sessions",
          scope.sessionId!,
          "MEMORY.md",
        ),
        "utf8",
      );
      const userArtifact = await readFile(
        join(
          outputPath,
          ".goodmemory",
          "users",
          scope.userId,
          "workspaces",
          scope.workspaceId!,
          "sessions",
          scope.sessionId!,
          "user.md",
        ),
        "utf8",
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Exported memory snapshot");
      expect(exported.scope.userId).toBe(scope.userId);
      expect(memoryArtifact).toContain("# MEMORY");
      expect(memoryArtifact).toContain("release quality program");
      expect(userArtifact).toContain("User Memory");
    } finally {
      await workspace.cleanup();
    }
  });

  it("defaults sqlite storage to the cwd .goodmemory path", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-default-sqlite");
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace.root);
      await seedSQLiteMemory(join(workspace.root, ".goodmemory", "memory.sqlite"));

      const result = await runCLI([
        "stats",
        "--user-id",
        "cli-user",
        "--workspace-id",
        "workspace-a",
        "--session-id",
        "session-1",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Storage Location: ");
      expect(result.stdout).toContain(
        join(".goodmemory", "memory.sqlite"),
      );
    } finally {
      process.chdir(previousCwd);
      await workspace.cleanup();
    }
  });

  it("remember writes durable memory through explicit scope flags and default sqlite storage", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-remember-default-sqlite");
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace.root);

      const result = await runCLI([
        "remember",
        "--user-id",
        "write-user",
        "--workspace-id",
        "workspace-a",
        "--session-id",
        "write-session",
        "--message",
        "Remember that the deploy is blocked on smoke verification.",
        "--json",
      ]);
      const payload = JSON.parse(result.stdout) as {
        accepted: number;
        scope: {
          sessionId?: string;
          userId: string;
          workspaceId?: string;
        };
        storage: {
          provider: string;
        };
      };

      expect(result.exitCode).toBe(0);
      expect(payload.accepted).toBeGreaterThan(0);
      expect(payload.scope).toEqual({
        sessionId: "write-session",
        userId: "write-user",
        workspaceId: "workspace-a",
      });
      expect(payload.storage.provider).toBe("sqlite");

      const stats = await runCLI([
        "stats",
        "--user-id",
        "write-user",
        "--workspace-id",
        "workspace-a",
        "--session-id",
        "write-session",
        "--json",
      ]);
      const statsPayload = JSON.parse(stats.stdout) as {
        counts: {
          facts: number;
        };
      };

      expect(stats.exitCode).toBe(0);
      expect(statsPayload.counts.facts).toBeGreaterThan(0);
    } finally {
      process.chdir(previousCwd);
      await workspace.cleanup();
    }
  });

  it("feedback derives installed-host defaults and is recalled through the host hook path", async () => {
    const home = await createTempWorkspace("goodmemory-feedback-host-home");
    const workspace = await createTempWorkspace("goodmemory-feedback-host-workspace");
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          expect(
            (await runCLI([
              "install",
              "codex",
              "--user-id",
              "codex-user",
            ])).exitCode,
          ).toBe(0);
          expect(
            (await runCLI([
              "enable",
              "codex",
              "--workspace-id",
              "workspace-a",
              "--workspace-root",
              workspace.root,
            ])).exitCode,
          ).toBe(0);

          const feedback = await runCLI([
            "feedback",
            "--host",
            "codex",
            "--workspace-root",
            workspace.root,
            "--session-id",
            "write-session",
            "--signal",
            "Use short next-step bullets in coding summaries.",
            "--json",
          ]);
          const payload = JSON.parse(feedback.stdout) as {
            accepted: boolean;
            kind?: string;
            memoryId?: string;
            scope: {
              agentId?: string;
              sessionId?: string;
              userId: string;
              workspaceId?: string;
            };
            storage: {
              provider: string;
            };
          };

          expect(feedback.exitCode).toBe(0);
          expect(payload.accepted).toBe(true);
          expect(payload.kind).toBeDefined();
          expect(payload.memoryId).toBeDefined();
          expect(payload.scope).toEqual({
            agentId: "codex",
            sessionId: "write-session",
            userId: "codex-user",
            workspaceId: "workspace-a",
          });
          expect(payload.storage.provider).toBe("sqlite");

          const hook = await runBunScript({
            args: ["codex", "hook", "user-prompt-submit"],
            cwd: workspace.root,
            env: {
              GOODMEMORY_HOME: home.root,
            },
            scriptPath: cliScript,
            stdin: JSON.stringify({
              cwd: workspace.root,
              prompt: "Summarize what style I prefer before you answer.",
              session_id: "write-session",
            }),
          });

          expect(hook.exitCode).toBe(0);
          expect(hook.stderr.trim()).toBe("");
          expect(hook.stdout).toContain("Use short next-step bullets in coding summaries.");
        },
      );
    } finally {
      await workspace.cleanup();
      await home.cleanup();
    }
  });

  it("host-derived write commands require repo opt-in before using installed-host defaults", async () => {
    const home = await createTempWorkspace("goodmemory-write-host-missing-enable-home");
    const workspace = await createTempWorkspace("goodmemory-write-host-missing-enable-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          expect(
            (await runCLI([
              "install",
              "codex",
              "--user-id",
              "codex-user",
            ])).exitCode,
          ).toBe(0);

          const result = await runCLI([
            "feedback",
            "--host",
            "codex",
            "--workspace-root",
            workspace.root,
            "--session-id",
            "write-session",
            "--signal",
            "Use short next-step bullets in coding summaries.",
          ]);

          expect(result.exitCode).toBe(1);
          expect(result.stderr).toContain("Run 'goodmemory enable codex --workspace-root");
        },
      );
    } finally {
      await workspace.cleanup();
      await home.cleanup();
    }
  });

  it("forget removes a host-derived memory id from the installed-host storage path", async () => {
    const home = await createTempWorkspace("goodmemory-forget-host-home");
    const workspace = await createTempWorkspace("goodmemory-forget-host-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          expect(
            (await runCLI([
              "install",
              "codex",
              "--user-id",
              "codex-user",
            ])).exitCode,
          ).toBe(0);
          expect(
            (await runCLI([
              "enable",
              "codex",
              "--workspace-id",
              "workspace-a",
              "--workspace-root",
              workspace.root,
            ])).exitCode,
          ).toBe(0);

          const feedback = await runCLI([
            "feedback",
            "--host",
            "codex",
            "--workspace-root",
            workspace.root,
            "--workspace-id",
            "workspace-a",
            "--session-id",
            "write-session",
            "--signal",
            "Use numbered checklists for deploy updates.",
            "--json",
          ]);
          const feedbackPayload = JSON.parse(feedback.stdout) as {
            memoryId?: string;
          };

          expect(feedback.exitCode).toBe(0);
          expect(feedbackPayload.memoryId).toBeDefined();

          const forgotten = await runCLI([
            "forget",
            "--host",
            "codex",
            "--workspace-root",
            workspace.root,
            "--workspace-id",
            "workspace-a",
            "--session-id",
            "write-session",
            "--memory-id",
            String(feedbackPayload.memoryId),
            "--json",
          ]);
          const forgottenPayload = JSON.parse(forgotten.stdout) as {
            forgotten: boolean;
            scope: {
              agentId?: string;
              sessionId?: string;
              userId: string;
              workspaceId?: string;
            };
          };

          expect(forgotten.exitCode).toBe(0);
          expect(forgottenPayload.forgotten).toBe(true);
          expect(forgottenPayload.scope).toEqual({
            agentId: "codex",
            sessionId: "write-session",
            userId: "codex-user",
            workspaceId: "workspace-a",
          });

          const stats = await runCLI([
            "stats",
            "--user-id",
            "codex-user",
            "--workspace-id",
            "workspace-a",
            "--agent-id",
            "codex",
            "--session-id",
            "write-session",
            "--storage-provider",
            "sqlite",
            "--storage-url",
            join(home.root, ".goodmemory", "memory.sqlite"),
            "--json",
          ]);
          const statsPayload = JSON.parse(stats.stdout) as {
            counts: {
              feedback: number;
            };
          };

          expect(stats.exitCode).toBe(0);
          expect(statsPayload.counts.feedback).toBe(0);
        },
      );
    } finally {
      await workspace.cleanup();
      await home.cleanup();
    }
  });

  it("forget supports deleting a full scoped target with --all", async () => {
    const workspace = await createTempWorkspace("goodmemory-forget-all");
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace.root);

      expect(
        (
          await runCLI([
            "remember",
            "--user-id",
            "forget-user",
            "--workspace-id",
            "workspace-a",
            "--session-id",
            "forget-session",
            "--message",
            "Remember that the deploy is blocked on smoke verification.",
          ])
        ).exitCode,
      ).toBe(0);
      expect(
        (
          await runCLI([
            "feedback",
            "--user-id",
            "forget-user",
            "--workspace-id",
            "workspace-a",
            "--session-id",
            "forget-session",
            "--signal",
            "Keep coding summaries short and list explicit next steps.",
          ])
        ).exitCode,
      ).toBe(0);

      const forgotten = await runCLI([
        "forget",
        "--all",
        "--user-id",
        "forget-user",
        "--workspace-id",
        "workspace-a",
        "--session-id",
        "forget-session",
        "--json",
      ]);
      const forgottenPayload = JSON.parse(forgotten.stdout) as {
        deleted: {
          facts: number;
          feedback: number;
        };
      };

      expect(forgotten.exitCode).toBe(0);
      expect(forgottenPayload.deleted.facts).toBeGreaterThan(0);
      expect(forgottenPayload.deleted.feedback).toBeGreaterThan(0);

      const stats = await runCLI([
        "stats",
        "--user-id",
        "forget-user",
        "--workspace-id",
        "workspace-a",
        "--session-id",
        "forget-session",
        "--json",
      ]);
      const statsPayload = JSON.parse(stats.stdout) as {
        counts: {
          facts: number;
          feedback: number;
        };
      };

      expect(stats.exitCode).toBe(0);
      expect(statsPayload.counts.facts).toBe(0);
      expect(statsPayload.counts.feedback).toBe(0);
    } finally {
      process.chdir(previousCwd);
      await workspace.cleanup();
    }
  });

  for (const command of ["inspect", "stats"] as const) {
    it(`${command} does not create default sqlite storage when the cwd store is missing`, async () => {
      const workspace = await createTempWorkspace(`goodmemory-cli-${command}-missing-store`);
      const previousCwd = process.cwd();

      try {
        process.chdir(workspace.root);

        const result = await runCLI([
          command,
          "--user-id",
          "review-user",
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(
          "Read-only CLI commands require an existing sqlite database",
        );
        await expect(
          access(join(workspace.root, ".goodmemory", "memory.sqlite")),
        ).rejects.toThrow();
      } finally {
        process.chdir(previousCwd);
        await workspace.cleanup();
      }
    });
  }

  it("trace does not create default sqlite storage when the cwd store is missing", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-trace-missing-store");
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace.root);

      const result = await runCLI([
        "trace",
        "--user-id",
        "review-user",
        "--query",
        "What should I do next?",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "Read-only CLI commands require an existing sqlite database",
      );
      await expect(
        access(join(workspace.root, ".goodmemory", "memory.sqlite")),
      ).rejects.toThrow();
    } finally {
      process.chdir(previousCwd);
      await workspace.cleanup();
    }
  });

  it("trace --ignore-memory bypasses default sqlite resolution in an empty workspace", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-trace-ignore-memory-missing-store");
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace.root);

      const result = await runCLI([
        "trace",
        "--user-id",
        "review-user",
        "--query",
        "What should I do next?",
        "--ignore-memory",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Storage: memory (ignored (--ignore-memory))");
      expect(result.stdout).toContain("Policy Applied");
      expect(result.stdout).toContain("- ignore_memory");
      await expect(
        access(join(workspace.root, ".goodmemory", "memory.sqlite")),
      ).rejects.toThrow();
    } finally {
      process.chdir(previousCwd);
      await workspace.cleanup();
    }
  });
});
