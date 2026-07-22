import { describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createEvidenceRecord,
  createFeedbackMemory,
  createGoodMemory,
  createMemorySource,
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
  EVIDENCE_COLLECTION,
} from "../../src";
import { executeInstalledHostAction } from "../../src/install/hostActionRuntime";
import { createTempWorkspace } from "../../src/testing/utils";

async function writeInstalledCodexConfig(input: {
  homeRoot: string;
  sqlitePath: string;
  workspaceId: string;
  workspaceRoot: string;
}): Promise<void> {
  await mkdir(join(input.homeRoot, ".goodmemory"), { recursive: true });
  await mkdir(join(input.workspaceRoot, ".goodmemory"), { recursive: true });
  await writeFile(
    join(input.homeRoot, ".goodmemory/codex.json"),
    JSON.stringify(
      {
        activationMode: "workspace_opt_in",
        debug: false,
        host: "codex",
        maxTokens: 256,
        retrievalProfile: "coding_agent",
        storage: {
          path: input.sqlitePath,
          provider: "sqlite",
        },
        userId: "cli-user",
        version: 1,
        writeback: {
          allowAssistantOutput: "confirmed_or_verified",
          dryRun: false,
          maxChars: 12000,
          maxMessages: 12,
          minConfidence: 0.7,
          mode: "off",
          persistRawTranscript: false,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(
    join(input.workspaceRoot, ".goodmemory/codex.json"),
    JSON.stringify(
      {
        enabled: true,
        host: "codex",
        version: 1,
        workspaceId: input.workspaceId,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

async function createSqliteMemory(sqlitePath: string) {
  await mkdir(dirname(sqlitePath), { recursive: true });
  const documentStore = createSQLiteDocumentStore(sqlitePath);
  const sessionStore = createSQLiteSessionStore(sqlitePath);
  const memory = createGoodMemory({
    adapters: {
      documentStore,
      sessionStore,
    },
    storage: {
      provider: "sqlite",
      url: sqlitePath,
    },
  });

  return {
    documentStore,
    memory,
    sessionStore,
  };
}

async function seedPolicy(input: {
  documentStore: ReturnType<typeof createSQLiteDocumentStore>;
  evidenceExcerpt: string;
  locale?: string;
  rule: string;
  sessionId: string;
  why?: string;
}): Promise<void> {
  const source = createMemorySource({
    method: "explicit",
    extractedAt: "2026-04-25T00:00:00.000Z",
    sessionId: input.sessionId,
    ...(input.locale
      ? { locale: input.locale, localeSource: "explicit" as const }
      : {}),
  });

  await input.documentStore.set(
    "feedback",
    `feedback-${input.sessionId}`,
    createFeedbackMemory({
      id: `feedback-${input.sessionId}`,
      userId: "cli-user",
      workspaceId: "workspace-a",
      sessionId: input.sessionId,
      kind: "validated_pattern",
      appliesTo: "coding_agent",
      rule: input.rule,
      ...(input.why ? { why: input.why } : {}),
      evidence: [`evidence-${input.sessionId}`],
      source,
    }),
  );
  await input.documentStore.set(
    EVIDENCE_COLLECTION,
    `evidence-${input.sessionId}`,
    createEvidenceRecord({
      id: `evidence-${input.sessionId}`,
      userId: "cli-user",
      workspaceId: "workspace-a",
      sessionId: input.sessionId,
      kind: input.evidenceExcerpt.includes("broke")
        ? "verification_result"
        : "correction_context",
      excerpt: input.evidenceExcerpt,
      source,
      sourceMessageIds: [`message-${input.sessionId}`],
    }),
  );
}

describe("installed host action integration", () => {
  it("rewrites DeepAnalyzer through the installed action bridge and writes lineage to the configured sqlite", async () => {
    const home = await createTempWorkspace("goodmemory-installed-action-home");
    const workspace = await createTempWorkspace("goodmemory-installed-action-workspace");
    const sqlitePath = join(home.root, ".goodmemory/memory.sqlite");

    try {
      await writeInstalledCodexConfig({
        homeRoot: home.root,
        sqlitePath,
        workspaceId: "workspace-a",
        workspaceRoot: workspace.root,
      });
      const { documentStore, memory } = await createSqliteMemory(sqlitePath);
      await seedPolicy({
        documentStore,
        evidenceExcerpt:
          "DeepAnalyzer detailed scan failed because QuickCheck had not run first.",
        rule: "Rather than DeepAnalyzer, use QuickCheck first.",
        sessionId: "action-session-1",
      });

      const result = await executeInstalledHostAction(
        {
          command: "./tools/DeepAnalyzer --detailed",
          cwd: workspace.root,
          homeRoot: home.root,
          host: "codex",
          sessionId: "action-session-1",
          turnId: "turn-1",
        },
        {
          runCommand: async () => ({
            exitCode: 0,
            stderr: "",
            stdout: "quickcheck",
          }),
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.payload).toMatchObject({
        decision: "review_required",
        executed: true,
        executedStep: "./tools/QuickCheck",
        rewritten: true,
      });

      const actionId = (result.payload as { actionId?: string }).actionId;
      const exported = await memory.exportMemory({
        includeRuntime: true,
        scope: {
          agentId: "codex",
          sessionId: "action-session-1",
          userId: "cli-user",
          workspaceId: "workspace-a",
        },
      });
      expect(
        exported.durable.experiences.some((record) => record.traceId === actionId),
      ).toBe(true);
      const followupTraceRecorded = actionId
        ? exported.durable.experiences.some(
            (record) =>
              Array.isArray(record.sourceTraceIds) &&
              record.sourceTraceIds.includes(actionId) &&
              record.traceId !== actionId,
          )
        : false;
      expect(
        followupTraceRecorded,
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

  it("vetoes destructive AGENTS deletion on the installed path without executing the command", async () => {
    const home = await createTempWorkspace("goodmemory-installed-block-home");
    const workspace = await createTempWorkspace("goodmemory-installed-block-workspace");
    const sqlitePath = join(home.root, ".goodmemory/memory.sqlite");

    try {
      await writeInstalledCodexConfig({
        homeRoot: home.root,
        sqlitePath,
        workspaceId: "workspace-a",
        workspaceRoot: workspace.root,
      });
      const { documentStore, memory } = await createSqliteMemory(sqlitePath);
      await seedPolicy({
        documentStore,
        evidenceExcerpt: "Deleting AGENTS.md broke the repo-local host bootstrap surface.",
        rule: "Never delete AGENTS.md from the host bootstrap surface.",
        sessionId: "action-session-2",
        why: "It breaks repo-local host wiring and package bootstrap continuity.",
      });

      let invoked = false;
      const result = await executeInstalledHostAction(
        {
          command: "rm -rf AGENTS.md",
          cwd: workspace.root,
          homeRoot: home.root,
          host: "codex",
          sessionId: "action-session-2",
          turnId: "turn-2",
        },
        {
          runCommand: async () => {
            invoked = true;
            return {
              exitCode: 0,
              stderr: "",
              stdout: "",
            };
          },
        },
      );

      expect(invoked).toBe(false);
      expect(result.exitCode).toBe(2);
      expect(result.payload).toMatchObject({
        decision: "blocked",
        executed: false,
        guidance: [
          "Never delete AGENTS.md from the host bootstrap surface.",
          "It breaks repo-local host wiring and package bootstrap continuity.",
        ],
        originalAction: "rm -rf AGENTS.md",
        rewritten: false,
      });

      const exported = await memory.exportMemory({
        includeRuntime: true,
        scope: {
          agentId: "codex",
          sessionId: "action-session-2",
          userId: "cli-user",
          workspaceId: "workspace-a",
        },
      });
      expect(exported.durable.experiences.length).toBeGreaterThan(0);
      expect(exported.durable.evidence.length).toBe(0);
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("applies a Japanese pre-action policy through the installed action bridge", async () => {
    const home = await createTempWorkspace("goodmemory-installed-ja-action-home");
    const workspace = await createTempWorkspace("goodmemory-installed-ja-action-workspace");
    const sqlitePath = join(home.root, ".goodmemory/memory.sqlite");

    try {
      await writeInstalledCodexConfig({
        homeRoot: home.root,
        sqlitePath,
        workspaceId: "workspace-a",
        workspaceRoot: workspace.root,
      });
      const { documentStore } = await createSqliteMemory(sqlitePath);
      const rule =
        "git push を実行する前に、検証せず実行しないでください。";
      await seedPolicy({
        documentStore,
        evidenceExcerpt: rule,
        locale: "ja-JP",
        rule,
        sessionId: "action-session-ja",
      });

      let invoked = false;
      const result = await executeInstalledHostAction(
        {
          command: "git push origin main",
          cwd: workspace.root,
          homeRoot: home.root,
          host: "codex",
          sessionId: "action-session-ja",
          turnId: "turn-ja",
        },
        {
          runCommand: async () => {
            invoked = true;
            return {
              exitCode: 0,
              stderr: "",
              stdout: "",
            };
          },
        },
      );

      expect(invoked).toBe(false);
      expect(result.exitCode).toBe(2);
      expect(result.payload).toMatchObject({
        decision: "review_required",
        executed: false,
        guidance: [rule],
        originalAction: "git push origin main",
        recommendedFirstStep: rule,
      });
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("applies Korean, French, and Spanish policies through the installed action bridge", async () => {
    const cases = [
      {
        locale: "ko-KR",
        rule: "검증 전에 git push를 실행하지 마세요.",
        suffix: "ko",
      },
      {
        locale: "fr-FR",
        rule: "Avant la validation, n’exécutez pas git push.",
        suffix: "fr",
      },
      {
        locale: "es-ES",
        rule: "Antes de la validación, no ejecutes git push.",
        suffix: "es",
      },
    ] as const;

    for (const entry of cases) {
      const home = await createTempWorkspace(
        `goodmemory-installed-${entry.suffix}-action-home`,
      );
      const workspace = await createTempWorkspace(
        `goodmemory-installed-${entry.suffix}-action-workspace`,
      );
      const sqlitePath = join(home.root, ".goodmemory/memory.sqlite");
      try {
        await writeInstalledCodexConfig({
          homeRoot: home.root,
          sqlitePath,
          workspaceId: "workspace-a",
          workspaceRoot: workspace.root,
        });
        const { documentStore } = await createSqliteMemory(sqlitePath);
        const sessionId = `action-session-${entry.suffix}`;
        await seedPolicy({
          documentStore,
          evidenceExcerpt: entry.rule,
          locale: entry.locale,
          rule: entry.rule,
          sessionId,
        });

        let invoked = false;
        const result = await executeInstalledHostAction(
          {
            command: "git push origin main",
            cwd: workspace.root,
            homeRoot: home.root,
            host: "codex",
            sessionId,
            turnId: `turn-${entry.suffix}`,
          },
          {
            runCommand: async () => {
              invoked = true;
              return { exitCode: 0, stderr: "", stdout: "" };
            },
          },
        );

        expect(invoked).toBe(false);
        expect(result.exitCode).toBe(2);
        expect(result.payload).toMatchObject({
          decision: "review_required",
          executed: false,
          guidance: [entry.rule],
          recommendedFirstStep: entry.rule,
        });
      } finally {
        await home.cleanup();
        await workspace.cleanup();
      }
    }
  });
});
