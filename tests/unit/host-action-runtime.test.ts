import { describe, expect, it } from "bun:test";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createFeedbackMemory,
  createGoodMemory,
  createMemorySource,
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
} from "../../src";
import { createEvidenceRecord, EVIDENCE_COLLECTION } from "../../src/evidence/contracts";
import {
  evaluateInstalledHostPreToolUse,
  executeInstalledHostAction,
} from "../../src/install/hostActionRuntime";

async function createWorkspace(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function seedWorkspaceScopedActionPolicy(input: {
  sessionId: string;
  sqlitePath: string;
  userId: string;
  workspaceId: string;
}): Promise<void> {
  await mkdir(dirname(input.sqlitePath), { recursive: true });
  const documentStore = createSQLiteDocumentStore(input.sqlitePath);
  const sessionStore = createSQLiteSessionStore(input.sqlitePath);
  createGoodMemory({
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

  await documentStore.set(
    "feedback",
    "feedback-installed-action-1",
    createFeedbackMemory({
      id: "feedback-installed-action-1",
      userId: input.userId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      kind: "validated_pattern",
      appliesTo: "coding_agent",
      rule: "Rather than DeepAnalyzer, use QuickCheck first.",
      evidence: ["evidence-installed-action-1"],
      source,
    }),
  );
  await documentStore.set(
    EVIDENCE_COLLECTION,
    "evidence-installed-action-1",
    createEvidenceRecord({
      id: "evidence-installed-action-1",
      userId: input.userId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      kind: "correction_context",
      excerpt: "DeepAnalyzer detailed scan failed because QuickCheck had not run first.",
      source,
      sourceMessageIds: ["message-installed-action-1"],
    }),
  );
}

async function writeInstalledCodexConfig(input: {
  activationMode?: "global" | "workspace_opt_in";
  homeRoot: string;
  sessionId?: string;
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
        activationMode: input.activationMode ?? "workspace_opt_in",
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

describe("installed host action runtime", () => {
  it("reads workspace-scoped policy memory even when installed host context adds agentId", async () => {
    const homeRoot = await createWorkspace("goodmemory-installed-action-home-");
    const workspaceRoot = await createWorkspace("goodmemory-installed-action-workspace-");
    const sqlitePath = join(homeRoot, ".goodmemory/memory.sqlite");

    try {
      await writeInstalledCodexConfig({
        homeRoot,
        sqlitePath,
        workspaceId: "workspace-a",
        workspaceRoot,
      });
      await seedWorkspaceScopedActionPolicy({
        sessionId: "action-session-1",
        sqlitePath,
        userId: "cli-user",
        workspaceId: "workspace-a",
      });

      const result = await evaluateInstalledHostPreToolUse({
        host: "codex",
        homeRoot,
        payload: {
          cwd: workspaceRoot,
          hook_event_name: "PreToolUse",
          session_id: "action-session-1",
          tool_input: {
            command: "./tools/DeepAnalyzer --detailed",
          },
          tool_name: "Bash",
          turn_id: "turn-1",
        },
      });

      expect(result.reason).toBe("applied");
      expect(result.output).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        },
      });
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not treat arbitrary command substrings as the installed managed action bridge", async () => {
    const homeRoot = await createWorkspace("goodmemory-installed-action-substring-home-");
    const workspaceRoot = await createWorkspace("goodmemory-installed-action-substring-workspace-");
    const sqlitePath = join(homeRoot, ".goodmemory/memory.sqlite");

    try {
      await writeInstalledCodexConfig({
        homeRoot,
        sqlitePath,
        workspaceId: "workspace-a",
        workspaceRoot,
      });
      await seedWorkspaceScopedActionPolicy({
        sessionId: "action-session-2",
        sqlitePath,
        userId: "cli-user",
        workspaceId: "workspace-a",
      });

      const result = await evaluateInstalledHostPreToolUse({
        host: "codex",
        homeRoot,
        payload: {
          cwd: workspaceRoot,
          hook_event_name: "PreToolUse",
          session_id: "action-session-2",
          tool_input: {
            command: "./tools/DeepAnalyzer --label 'goodmemory codex action' --detailed",
          },
          tool_name: "Bash",
          turn_id: "turn-2",
        },
      });

      expect(result.reason).toBe("applied");
      expect(result.output).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        },
      });
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("derives a stable fallback action id for repeated identical pre-tool events", async () => {
    const homeRoot = await createWorkspace("goodmemory-installed-action-stable-id-home-");
    const workspaceRoot = await createWorkspace("goodmemory-installed-action-stable-id-workspace-");
    const sqlitePath = join(homeRoot, ".goodmemory/memory.sqlite");

    try {
      await writeInstalledCodexConfig({
        homeRoot,
        sqlitePath,
        workspaceId: "workspace-a",
        workspaceRoot,
      });
      await seedWorkspaceScopedActionPolicy({
        sessionId: "action-session-stable",
        sqlitePath,
        userId: "cli-user",
        workspaceId: "workspace-a",
      });

      const payload = {
        cwd: workspaceRoot,
        hook_event_name: "PreToolUse",
        sequence: 4,
        session_id: "action-session-stable",
        tool_input: {
          command: "./tools/DeepAnalyzer --detailed",
        },
        tool_name: "Bash",
      };

      const first = await evaluateInstalledHostPreToolUse({
        host: "codex",
        homeRoot,
        payload,
      });
      const second = await evaluateInstalledHostPreToolUse({
        host: "codex",
        homeRoot,
        payload,
      });
      const firstOutput = first.output as
        | {
            hookSpecificOutput?: {
              permissionDecisionReason?: string;
            };
          }
        | null;
      const secondOutput = second.output as
        | {
            hookSpecificOutput?: {
              permissionDecisionReason?: string;
            };
          }
        | null;
      const firstReason = firstOutput?.hookSpecificOutput?.permissionDecisionReason ?? "";
      const secondReason = secondOutput?.hookSpecificOutput?.permissionDecisionReason ?? "";
      const firstActionId = firstReason.match(/--action-id '([^']+)'/)?.[1];
      const secondActionId = secondReason.match(/--action-id '([^']+)'/)?.[1];

      expect(first.reason).toBe("applied");
      expect(second.reason).toBe("applied");
      expect(firstActionId).toBeDefined();
      expect(secondActionId).toBe(firstActionId);
      expect(firstReason).toContain("--turn-id 'goodmemory-installed-pretool-turn'");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("merges broader-scope runtime guidance into partially populated installed runtime snapshots", async () => {
    const homeRoot = await createWorkspace("goodmemory-installed-action-runtime-home-");
    const workspaceRoot = await createWorkspace("goodmemory-installed-action-runtime-workspace-");
    const sqlitePath = join(homeRoot, ".goodmemory/memory.sqlite");

    try {
      await writeInstalledCodexConfig({
        homeRoot,
        sqlitePath,
        workspaceId: "workspace-a",
        workspaceRoot,
      });
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
      const scope = {
        userId: "cli-user",
        workspaceId: "workspace-a",
        sessionId: "action-session-3",
      };
      const agentScope = {
        ...scope,
        agentId: "codex",
      };

      await memory.runtime.startSession({ scope });
      await memory.runtime.startSession({ scope: agentScope });
      await memory.runtime.updateWorkingMemory({
        scope: agentScope,
        patch: {
          currentGoal: "Close the installed pre-action rollout",
        },
      });
      await memory.runtime.updateWorkingMemory({
        scope,
        patch: {
          temporaryDecisions: ["Use the current runbook before deploy."],
        },
      });
      await memory.runtime.updateSessionJournal({
        scope,
        patch: {
          currentState: "Deployment verification still needs the current runbook.",
          workflow: ["Review the exported session handoff"],
        },
      });

      const result = await executeInstalledHostAction(
        {
          command: "deploy preview",
          cwd: workspaceRoot,
          homeRoot,
          host: "codex",
          sessionId: "action-session-3",
          turnId: "turn-3",
        },
        {
          runCommand: async () => ({
            exitCode: 0,
            stderr: "",
            stdout: "deploy preview",
          }),
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.payload).toMatchObject({
        decision: "allow_with_guidance",
        executed: true,
        executedStep: "deploy preview",
        guidance: [
          "Use the current runbook before deploy.",
          "Workflow: Review the exported session handoff",
        ],
        originalAction: "deploy preview",
      });
      expect((result.payload as { reason?: string }).reason).toContain(
        "Guidance: Use the current runbook before deploy.",
      );
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
