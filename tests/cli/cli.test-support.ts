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
  // Generated scripts run from temp workspaces without a node_modules; Bun's
  // auto-install would otherwise resolve a bare `goodmemory` import from the
  // registry (the published package), not from this repo's build, and the
  // outcome would depend on the global install cache.
  const childProcess = Bun.spawn({
    cmd: ["bun", "--no-install", input.scriptPath, ...(input.args ?? [])],
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


export {
  EVIDENCE_COLLECTION,
  HOST_BOOTSTRAP_SCRIPT_TEST_TIMEOUT_MS,
  TEXT_DECODER,
  access,
  aggregateJudgedCases,
  basename,
  buildAnswerPackage,
  buildAssertions,
  buildCase,
  buildJudgeResult,
  buildWritebackScopeDigest,
  chmod,
  createEvidenceRecord,
  createFactMemory,
  createFeedbackMemory,
  createGoodMemory,
  createMemoryRepositories,
  createMemorySource,
  createReferenceMemory,
  createSessionArchive,
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
  createTempWorkspace,
  createUserProfile,
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
};
export type { JudgedEvalCase };
