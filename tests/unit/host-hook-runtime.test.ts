import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type {
  GoodMemory,
  GoodMemoryConfig,
  RecallResult,
} from "../../src/api/contracts";
import { createMemorySource } from "../../src/domain/provenance";
import { createFactMemory } from "../../src/domain/records";
import { executeInstalledHostHook } from "../../src/install/hostHookRuntime";
import { registerInstalledHostMcp } from "../../src/install/hostMcpConfig";
import { readInstalledHostWritebackLedger } from "../../src/install/hostWritebackAuditLedger";
import { readInstalledHostProgressiveRecordCache } from "../../src/install/hostProgressiveRecall";
import {
  createNoopGoodMemoryJobsFacade,
  createNoopGoodMemoryRuntimeFacade,
} from "../../src/testing/fakes";

async function createWorkspace(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function createRecallResult(overrides: Partial<RecallResult> = {}): RecallResult {
  const result: RecallResult = {
    archives: [],
    episodes: [],
    evidence: [],
    facts: [],
    feedback: [],
    journal: null,
    packet: {
      debug: {
        estimatedTokens: 0,
        omittedSections: [],
      },
      renderingProfile: "coding_agent",
    },
    preferences: [],
    profile: null,
    references: [],
    notes: [],
    workingMemory: null,
    metadata: {
      languagePackId: "en",
      analysisMode: "rules-only",
      candidateTraces: [],
      hits: [],
      latencyMs: 1,
      policyApplied: [],
      routingDecision: {
        actionDriving: false,
        continuation: false,
        intent: "general_assistance",
        referenceSeeking: false,
        requestedSlots: [],
        retrievalProfile: "coding_agent",
        sourcePriorities: [],
        strategy: "rules-only",
        strategyExplanation: {
          hardFloor: "lexical_runtime_procedural_priors",
          llmRefinement: false,
          requestedStrategy: "rules-only",
          resolvedStrategy: "rules-only",
          semanticTieBreaking: false,
          summary: "test",
        },
        supportSlots: [],
      },
      tokenCount: 1,
      verificationHints: [],
    },
  };

  return {
    ...result,
    ...overrides,
  };
}

describe("installed host hook runtime", () => {
  it("derives scope and emits additionalContext for user prompt submit", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-home-");
    const workspaceRoot = await createWorkspace("goodmemory-hook-workspace-");
    const calls: {
      buildContext?: {
        maxTokens?: number;
        output?: string;
      };
      recall?: {
        query?: string;
        retrievalProfile?: string;
        scope?: {
          agentId?: string;
          sessionId?: string;
          userId?: string;
          workspaceId?: string;
        };
      };
      storage?: GoodMemoryConfig["storage"];
    } = {};

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await mkdir(join(workspaceRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(homeRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            debug: false,
            host: "codex",
            maxTokens: 320,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "hook-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(workspaceRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            enabled: true,
            host: "codex",
            maxTokens: 96,
            version: 1,
            workspaceId: "workspace-hook",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const result = await executeInstalledHostHook(
        {
          command: "user-prompt-submit",
          host: "codex",
          homeRoot,
          payload: {
            cwd: workspaceRoot,
            prompt: "Check the release runbook before editing files.",
            session_id: "session-42",
          },
        },
        {
          createMemory: ((config: GoodMemoryConfig) => {
            calls.storage = config.storage;
            return {
              jobs: createNoopGoodMemoryJobsFacade(),
              runtime: createNoopGoodMemoryRuntimeFacade(),
              async buildContext(input) {
                calls.buildContext = {
                  maxTokens: input.maxTokens,
                  output: input.output,
                };
                return {
                  content: "Developer memory notes:\nRunbook: docs/release-quality-runbook.md",
                  estimatedTokens: 12,
                  omittedSections: [],
                  output: "developer_prompt_fragment",
                };
              },
              async recall(input) {
                calls.recall = {
                  query: input.query,
                  retrievalProfile: input.retrievalProfile,
                  scope: input.scope,
                };
                return createRecallResult();
              },
              async remember() {
                throw new Error("not used");
              },
              async forget() {
                throw new Error("not used");
              },
              async importMemory() {
                throw new Error("importMemory is not implemented by this fake.");
              },
              async exportMemory() {
                throw new Error("not used");
              },
              async deleteAllMemory() {
                throw new Error("not used");
              },
              async feedback() {
                throw new Error("not used");
              },
              async reviseMemory() {
                throw new Error("not used");
              },
              async runMaintenance() {
                throw new Error("not used");
              },
            } satisfies GoodMemory;
          }) as (config: GoodMemoryConfig) => GoodMemory,
        },
      );

      expect(result.applied).toBe(true);
      expect(result.reason).toBe("applied");
      expect(result.context).toContain("Developer memory notes");
      expect(result.output).toEqual({
        hookSpecificOutput: {
          additionalContext:
            "Developer memory notes:\nRunbook: docs/release-quality-runbook.md",
          hookEventName: "UserPromptSubmit",
        },
      });
      expect(calls.storage).toEqual({
        provider: "sqlite",
        url: join(homeRoot, ".goodmemory/memory.sqlite"),
      });
      expect(calls.recall).toEqual({
        query: "Check the release runbook before editing files.",
        retrievalProfile: "coding_agent",
        scope: {
          agentId: "codex",
          sessionId: "session-42",
          userId: "hook-user",
          workspaceId: "workspace-hook",
        },
      });
      expect(calls.buildContext).toEqual({
        maxTokens: 96,
        output: "developer_prompt_fragment",
      });
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("falls back to fragment context when progressive mode has no MCP detail transport", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-progressive-fallback-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-hook-progressive-fallback-workspace-",
    );
    let buildContextCalled = false;

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await mkdir(join(workspaceRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(homeRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            contextMode: "progressive",
            debug: false,
            host: "codex",
            maxTokens: 320,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "hook-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(workspaceRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            enabled: true,
            host: "codex",
            version: 1,
            workspaceId: "workspace-hook",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const result = await executeInstalledHostHook(
        {
          command: "user-prompt-submit",
          host: "codex",
          homeRoot,
          payload: {
            cwd: workspaceRoot,
            prompt: "Check the release runbook before editing files.",
            session_id: "session-42",
          },
        },
        {
          createMemory: ((_: GoodMemoryConfig) =>
            ({
              jobs: createNoopGoodMemoryJobsFacade(),
              runtime: createNoopGoodMemoryRuntimeFacade(),
              async buildContext() {
                buildContextCalled = true;
                return {
                  content: "Developer memory notes:\nFragment fallback stays available.",
                  estimatedTokens: 10,
                  omittedSections: [],
                  output: "developer_prompt_fragment",
                };
              },
              async recall() {
                return createRecallResult();
              },
              async remember() {
                throw new Error("not used");
              },
              async forget() {
                throw new Error("not used");
              },
              async importMemory() {
                throw new Error("importMemory is not implemented by this fake.");
              },
              async exportMemory() {
                throw new Error("not used");
              },
              async deleteAllMemory() {
                throw new Error("not used");
              },
              async feedback() {
                throw new Error("not used");
              },
              async reviseMemory() {
                throw new Error("not used");
              },
              async runMaintenance() {
                throw new Error("not used");
              },
            }) satisfies GoodMemory) as (config: GoodMemoryConfig) => GoodMemory,
        },
      );

      expect(result.applied).toBe(true);
      expect(result.context).toContain("Developer memory notes");
      expect(result.context).not.toContain("Progressive GoodMemory Recall");
      expect(buildContextCalled).toBe(true);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("uses progressive context and caches drill-down records when MCP is registered", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-progressive-home-");
    const workspaceRoot = await createWorkspace("goodmemory-hook-progressive-workspace-");
    let buildContextCalled = false;

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await mkdir(join(workspaceRoot, ".goodmemory"), { recursive: true });
      await registerInstalledHostMcp({
        homeRoot,
        host: "codex",
      });
      await writeFile(
        join(homeRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            contextMode: "progressive",
            debug: false,
            host: "codex",
            maxTokens: 80,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "hook-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(workspaceRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            enabled: true,
            host: "codex",
            version: 1,
            workspaceId: "workspace-hook",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const source = createMemorySource({
        extractedAt: "2026-01-01T00:00:00.000Z",
        method: "explicit",
        sessionId: "session-42",
      });
      const fact = createFactMemory({
        agentId: "codex",
        category: "project",
        content: "The release runbook is docs/release-quality-runbook.md.",
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "fact-progressive-hook",
        sessionId: "session-42",
        source,
        updatedAt: "2026-01-01T00:00:00.000Z",
        userId: "hook-user",
        workspaceId: "workspace-hook",
      });

      const result = await executeInstalledHostHook(
        {
          command: "user-prompt-submit",
          host: "codex",
          homeRoot,
          payload: {
            cwd: workspaceRoot,
            prompt: "Check the release runbook before editing files.",
            session_id: "session-42",
          },
        },
        {
          createMemory: ((_: GoodMemoryConfig) =>
            ({
              jobs: createNoopGoodMemoryJobsFacade(),
              runtime: createNoopGoodMemoryRuntimeFacade(),
              async buildContext() {
                buildContextCalled = true;
                throw new Error("fragment context should not run");
              },
              async recall() {
                return createRecallResult({
                  facts: [fact],
                });
              },
              async remember() {
                throw new Error("not used");
              },
              async forget() {
                throw new Error("not used");
              },
              async importMemory() {
                throw new Error("importMemory is not implemented by this fake.");
              },
              async exportMemory() {
                throw new Error("not used");
              },
              async deleteAllMemory() {
                throw new Error("not used");
              },
              async feedback() {
                throw new Error("not used");
              },
              async reviseMemory() {
                throw new Error("not used");
              },
              async runMaintenance() {
                throw new Error("not used");
              },
            }) satisfies GoodMemory) as (config: GoodMemoryConfig) => GoodMemory,
        },
      );

      expect(result.applied).toBe(true);
      expect(result.context).toContain("Progressive GoodMemory Recall");
      expect(result.context).toContain("gmrec:v1:");
      expect(result.context!.length).toBeLessThanOrEqual(80 * 4);
      expect(result.context).not.toContain("hook-user");
      expect(result.context).not.toContain("workspace-hook");
      expect(buildContextCalled).toBe(false);

      const recordRef = result.context?.match(/gmrec:v1:\S+/u)?.[0];
      if (!recordRef) {
        throw new Error("Expected progressive hook context to include a recordRef.");
      }
      const scopeDigest = recordRef.split(":")[2];
      if (!scopeDigest) {
        throw new Error("Expected progressive recordRef to include a scope digest.");
      }
      const cachedRecords = await readInstalledHostProgressiveRecordCache({
        homeRoot,
        host: "codex",
        recordRefs: [recordRef],
        scopeDigest,
      });
      expect(cachedRecords).toMatchObject([
        {
          recordKind: "fact",
          recordRef,
        },
      ]);
      expect(JSON.stringify(cachedRecords)).toContain("release-quality-runbook.md");
      expect(JSON.stringify(cachedRecords)).not.toContain("hook-user");
      expect((await stat(join(homeRoot, ".goodmemory/codex-progressive-records.json"))).mode & 0o777)
        .toBe(0o600);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("creates GoodMemory with installed provider adapters from host config", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-provider-home-");
    const workspaceRoot = await createWorkspace("goodmemory-hook-provider-workspace-");
    const calls: {
      assistedExtractorConfigured?: boolean;
      embeddingAdapterConfigured?: boolean;
      storage?: GoodMemoryConfig["storage"];
    } = {};

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await mkdir(join(workspaceRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(homeRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            debug: false,
            host: "codex",
            maxTokens: 320,
            providers: {
              assistedExtractor: {
                apiKey: "llm-secret",
                model: "claude-3-5-haiku-latest",
                provider: "anthropic",
              },
              embedding: {
                apiKey: "embedding-secret",
                model: "text-embedding-3-small",
                provider: "openai",
              },
            },
            retrievalProfile: "coding_agent",
            storage: {
              provider: "postgres",
              url: "postgres://postgres:secret@localhost:5432/goodmemory",
            },
            userId: "hook-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(workspaceRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            enabled: true,
            host: "codex",
            version: 1,
            workspaceId: "workspace-hook",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const result = await executeInstalledHostHook(
        {
          command: "user-prompt-submit",
          host: "codex",
          homeRoot,
          payload: {
            cwd: workspaceRoot,
            prompt: "Check project memory.",
            session_id: "session-42",
          },
        },
        {
          createMemory: ((config: GoodMemoryConfig) => {
            calls.storage = config.storage;
            calls.assistedExtractorConfigured = Boolean(
              config.adapters?.assistedExtractor,
            );
            calls.embeddingAdapterConfigured = Boolean(
              config.adapters?.embeddingAdapter,
            );
            return {
              jobs: createNoopGoodMemoryJobsFacade(),
              runtime: createNoopGoodMemoryRuntimeFacade(),
              async buildContext() {
                return {
                  content: "Developer memory notes:\nProvider-backed memory is configured.",
                  estimatedTokens: 10,
                  omittedSections: [],
                  output: "developer_prompt_fragment",
                };
              },
              async recall() {
                return createRecallResult();
              },
              async remember() {
                throw new Error("not used");
              },
              async forget() {
                throw new Error("not used");
              },
              async importMemory() {
                throw new Error("importMemory is not implemented by this fake.");
              },
              async exportMemory() {
                throw new Error("not used");
              },
              async deleteAllMemory() {
                throw new Error("not used");
              },
              async feedback() {
                throw new Error("not used");
              },
              async reviseMemory() {
                throw new Error("not used");
              },
              async runMaintenance() {
                throw new Error("not used");
              },
            } satisfies GoodMemory;
          }) as (config: GoodMemoryConfig) => GoodMemory,
        },
      );

      expect(result.applied).toBe(true);
      expect(calls.storage).toEqual({
        provider: "postgres",
        url: "postgres://postgres:secret@localhost:5432/goodmemory",
      });
      expect(calls.assistedExtractorConfigured).toBe(true);
      expect(calls.embeddingAdapterConfigured).toBe(true);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("fails open with a debug systemMessage when the workspace is disabled", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-disabled-home-");
    const workspaceRoot = await createWorkspace("goodmemory-hook-disabled-workspace-");

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await mkdir(join(workspaceRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(homeRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            debug: true,
            host: "codex",
            maxTokens: 320,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "hook-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(workspaceRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            debug: true,
            enabled: false,
            host: "codex",
            version: 1,
            workspaceId: "workspace-hook",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const result = await executeInstalledHostHook({
        command: "user-prompt-submit",
        host: "codex",
        homeRoot,
        payload: {
          cwd: workspaceRoot,
          prompt: "Check the release runbook before editing files.",
          session_id: "session-42",
        },
      });

      expect(result.applied).toBe(false);
      expect(result.reason).toBe("disabled");
      expect(result.context).toBeNull();
      expect(result.output).toEqual({
        systemMessage: "GoodMemory codex user-prompt-submit hook skipped: disabled.",
      });
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("uses global activation mode without a repo config and keeps prompt-submit recall read-only", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-global-home-");
    const workspaceRoot = await createWorkspace("goodmemory-hook-global-workspace-");
    const rememberCalls: Array<{
      extractionStrategy?: string;
      message: string;
      scope: {
        agentId?: string;
        sessionId?: string;
        userId?: string;
        workspaceId?: string;
      };
    }> = [];

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(homeRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            activationMode: "global",
            writeback: {
              mode: "selective",
            },
            debug: false,
            host: "codex",
            maxTokens: 320,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "hook-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const result = await executeInstalledHostHook(
        {
          command: "user-prompt-submit",
          host: "codex",
          homeRoot,
          payload: {
            cwd: workspaceRoot,
            prompt: "Always check the release runbook before editing files.",
            session_id: "session-42",
            turn_id: "turn-1",
          },
        },
        {
          createMemory: ((_: GoodMemoryConfig) =>
            ({
              jobs: createNoopGoodMemoryJobsFacade(),
              runtime: createNoopGoodMemoryRuntimeFacade(),
              async buildContext() {
                return {
                  content: "Developer memory notes:\nRelease runbook is canonical.",
                  estimatedTokens: 9,
                  omittedSections: [],
                  output: "developer_prompt_fragment",
                };
              },
              async recall() {
                return createRecallResult();
              },
              async remember(input) {
                rememberCalls.push({
                  extractionStrategy: input.extractionStrategy,
                  message: input.messages[0]?.content ?? "",
                  scope: input.scope,
                });
                return {
                  accepted: 1,
                  events: [],
                  rejected: 0,
                };
              },
              async forget() {
                throw new Error("not used");
              },
              async importMemory() {
                throw new Error("importMemory is not implemented by this fake.");
              },
              async exportMemory() {
                throw new Error("not used");
              },
              async deleteAllMemory() {
                throw new Error("not used");
              },
              async feedback() {
                throw new Error("not used");
              },
              async reviseMemory() {
                throw new Error("not used");
              },
              async runMaintenance() {
                throw new Error("not used");
              },
            }) satisfies GoodMemory) as (config: GoodMemoryConfig) => GoodMemory,
        },
      );

      expect(result.applied).toBe(true);
      expect(result.writeback).toEqual({
        attempted: false,
        candidateCount: 0,
        reason: "source_disabled",
        wrote: false,
      });
      expect(rememberCalls).toHaveLength(0);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("runs selective writeback for bounded stop-hook session signals without blocking output", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-stop-home-");
    const workspaceRoot = await createWorkspace("goodmemory-hook-stop-workspace-");
    const rememberMessages: string[] = [];

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(homeRoot, ".goodmemory/claude.json"),
        JSON.stringify(
          {
            activationMode: "global",
            writeback: {
              mode: "selective",
            },
            debug: false,
            host: "claude",
            maxTokens: 128,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "hook-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const result = await executeInstalledHostHook(
        {
          command: "session-stop",
          host: "claude",
          homeRoot,
          payload: {
            cwd: workspaceRoot,
            messages: [
              { role: "user", content: "Remember to keep summaries short." },
              { role: "assistant", content: "I will keep coding summaries short." },
            ],
            session_id: "session-77",
          },
        },
        {
          createMemory: ((_: GoodMemoryConfig) =>
            ({
              jobs: createNoopGoodMemoryJobsFacade(),
              runtime: createNoopGoodMemoryRuntimeFacade(),
              async buildContext() {
                throw new Error("not used");
              },
              async recall() {
                throw new Error("not used");
              },
              async remember(input) {
                rememberMessages.push(input.messages[0]?.content ?? "");
                return {
                  accepted: 1,
                  events: [],
                  rejected: 0,
                };
              },
              async forget() {
                throw new Error("not used");
              },
              async importMemory() {
                throw new Error("importMemory is not implemented by this fake.");
              },
              async exportMemory() {
                throw new Error("not used");
              },
              async deleteAllMemory() {
                throw new Error("not used");
              },
              async feedback() {
                throw new Error("not used");
              },
              async reviseMemory() {
                throw new Error("not used");
              },
              async runMaintenance() {
                throw new Error("not used");
              },
            }) satisfies GoodMemory) as (config: GoodMemoryConfig) => GoodMemory,
        },
      );

      expect(result.applied).toBe(false);
      expect(result.reason).toBe("writeback_written");
      expect(result.output).toBeNull();
      expect(result.writeback).toEqual({
        attempted: true,
        candidateCount: 1,
        mode: "selective",
        reason: "written",
        wrote: true,
      });
      expect(rememberMessages).toHaveLength(1);
      expect(rememberMessages[0]).toBe("Remember to keep summaries short.");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("dedupes concurrent writeback events under the ledger lock", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-stop-lock-home-");
    const workspaceRoot = await createWorkspace("goodmemory-hook-stop-lock-workspace-");
    let rememberCallCount = 0;
    let releaseRemember: (() => void) | undefined;
    let markRememberEntered: (() => void) | undefined;
    const rememberEntered = new Promise<void>((resolve) => {
      markRememberEntered = resolve;
    });
    const rememberRelease = new Promise<void>((resolve) => {
      releaseRemember = resolve;
    });

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(homeRoot, ".goodmemory/claude.json"),
        JSON.stringify(
          {
            activationMode: "global",
            writeback: {
              mode: "selective",
            },
            debug: false,
            host: "claude",
            maxTokens: 128,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "hook-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const dependencies = {
        createMemory: ((_: GoodMemoryConfig) =>
          ({
            jobs: createNoopGoodMemoryJobsFacade(),
            runtime: createNoopGoodMemoryRuntimeFacade(),
            async buildContext() {
              throw new Error("not used");
            },
            async recall() {
              throw new Error("not used");
            },
            async remember() {
              rememberCallCount += 1;
              markRememberEntered?.();
              await rememberRelease;
              return {
                accepted: 1,
                events: [],
                rejected: 0,
              };
            },
            async forget() {
              throw new Error("not used");
            },
            async importMemory() {
              throw new Error("importMemory is not implemented by this fake.");
            },
            async exportMemory() {
              throw new Error("not used");
            },
            async deleteAllMemory() {
              throw new Error("not used");
            },
            async feedback() {
              throw new Error("not used");
            },
            async reviseMemory() {
              throw new Error("not used");
            },
            async runMaintenance() {
              throw new Error("not used");
            },
          }) satisfies GoodMemory) as (config: GoodMemoryConfig) => GoodMemory,
      };

      const firstRun = executeInstalledHostHook(
        {
          command: "session-stop",
          host: "claude",
          homeRoot,
          payload: {
            cwd: workspaceRoot,
            event_id: "stop-1",
            session_id: "session-77",
            summary: "Always keep summaries short.",
            summary_confirmed: true,
          },
        },
        dependencies,
      );
      await rememberEntered;

      const secondRun = executeInstalledHostHook(
        {
          command: "session-stop",
          host: "claude",
          homeRoot,
          payload: {
            cwd: workspaceRoot,
            event_id: "stop-1",
            session_id: "session-77",
            summary: "Always keep summaries short.",
            summary_confirmed: true,
          },
        },
        dependencies,
      );

      releaseRemember?.();

      const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);

      expect(rememberCallCount).toBe(1);
      expect([firstResult.writeback.reason, secondResult.writeback.reason].sort()).toEqual([
        "no_candidates",
        "written",
      ]);
    } finally {
      releaseRemember?.();
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("reports observe audit persistence failures as writeback failures", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-observe-audit-fail-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-hook-observe-audit-fail-workspace-",
    );

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(homeRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            activationMode: "global",
            writeback: {
              mode: "observe",
            },
            debug: false,
            host: "codex",
            maxTokens: 128,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "hook-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await mkdir(join(homeRoot, ".goodmemory/codex-writeback-events.json"), {
        recursive: true,
      });

      const result = await executeInstalledHostHook({
        command: "session-stop",
        host: "codex",
        homeRoot,
        payload: {
          cwd: workspaceRoot,
          messages: [
            {
              content: "Always run typecheck before closing the phase.",
              role: "user",
            },
          ],
          session_id: "session-78",
        },
      });

      expect(result.reason).toBe("writeback_failed");
      expect(result.writeback).toEqual({
        attempted: true,
        candidateCount: 1,
        mode: "observe",
        reason: "failed",
        wrote: false,
      });
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("fails writeback closed when the ledger file is malformed", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-stop-ledger-home-");
    const workspaceRoot = await createWorkspace("goodmemory-hook-stop-ledger-workspace-");
    let rememberCalled = false;

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(homeRoot, ".goodmemory/claude.json"),
        JSON.stringify(
          {
            activationMode: "global",
            writeback: {
              mode: "selective",
            },
            debug: false,
            host: "claude",
            maxTokens: 128,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "hook-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(homeRoot, ".goodmemory/claude-writeback-events.json"),
        JSON.stringify({ events: "bad-ledger" }, null, 2) + "\n",
        "utf8",
      );

      const result = await executeInstalledHostHook(
        {
          command: "session-stop",
          host: "claude",
          homeRoot,
          payload: {
            cwd: workspaceRoot,
            event_id: "stop-2",
            session_id: "session-78",
            summary: "Always keep summaries short.",
            summary_confirmed: true,
          },
        },
        {
          createMemory: ((_: GoodMemoryConfig) =>
            ({
              jobs: createNoopGoodMemoryJobsFacade(),
              runtime: createNoopGoodMemoryRuntimeFacade(),
              async buildContext() {
                throw new Error("not used");
              },
              async recall() {
                throw new Error("not used");
              },
              async remember() {
                rememberCalled = true;
                return {
                  accepted: 1,
                  events: [],
                  rejected: 0,
                };
              },
              async forget() {
                throw new Error("not used");
              },
              async importMemory() {
                throw new Error("importMemory is not implemented by this fake.");
              },
              async exportMemory() {
                throw new Error("not used");
              },
              async deleteAllMemory() {
                throw new Error("not used");
              },
              async feedback() {
                throw new Error("not used");
              },
              async reviseMemory() {
                throw new Error("not used");
              },
              async runMaintenance() {
                throw new Error("not used");
              },
            }) satisfies GoodMemory) as (config: GoodMemoryConfig) => GoodMemory,
        },
      );

      expect(rememberCalled).toBe(false);
      expect(result.reason).toBe("writeback_failed");
      expect(result.writeback).toEqual({
        attempted: true,
        candidateCount: 1,
        mode: "selective",
        reason: "failed",
        wrote: false,
      });
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("uses a continuity query for session start", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-session-home-");
    const workspaceRoot = await createWorkspace("goodmemory-hook-session-workspace-");
    let capturedLocale: string | undefined;
    let capturedQuery: string | undefined;

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await mkdir(join(workspaceRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(homeRoot, ".goodmemory/claude.json"),
        JSON.stringify(
          {
            debug: false,
            host: "claude",
            language: { defaultLocale: "ja-JP" },
            maxTokens: 128,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "hook-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(workspaceRoot, ".goodmemory/claude.json"),
        JSON.stringify(
          {
            enabled: true,
            host: "claude",
            version: 1,
            workspaceId: "workspace-hook",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const result = await executeInstalledHostHook(
        {
          command: "session-start",
          host: "claude",
          homeRoot,
          payload: {
            cwd: workspaceRoot,
            session_id: "session-99",
            source: "resume",
          },
        },
        {
          createMemory: ((_: GoodMemoryConfig) =>
            ({
              jobs: createNoopGoodMemoryJobsFacade(),
              runtime: createNoopGoodMemoryRuntimeFacade(),
              async buildContext() {
                return {
                  content: "Developer memory notes:\nResume active coding guidance.",
                  estimatedTokens: 10,
                  omittedSections: [],
                  output: "developer_prompt_fragment",
                };
              },
              async recall(input) {
                capturedLocale = input.locale;
                capturedQuery = input.query;
                return createRecallResult();
              },
              async remember() {
                throw new Error("not used");
              },
              async forget() {
                throw new Error("not used");
              },
              async importMemory() {
                throw new Error("importMemory is not implemented by this fake.");
              },
              async exportMemory() {
                throw new Error("not used");
              },
              async deleteAllMemory() {
                throw new Error("not used");
              },
              async feedback() {
                throw new Error("not used");
              },
              async reviseMemory() {
                throw new Error("not used");
              },
              async runMaintenance() {
                throw new Error("not used");
              },
            }) satisfies GoodMemory) as (config: GoodMemoryConfig) => GoodMemory,
        },
      );

      expect(result.applied).toBe(true);
      expect(result.output).toEqual({
        hookSpecificOutput: {
          additionalContext:
            "Developer memory notes:\nResume active coding guidance.",
          hookEventName: "SessionStart",
        },
      });
      expect(capturedLocale).toBe("ja-JP");
      expect(capturedQuery).toContain("再開");
      expect(capturedQuery).not.toContain("resume");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("fails open when the repo opt-in config has malformed field types", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-invalid-home-");
    const workspaceRoot = await createWorkspace("goodmemory-hook-invalid-workspace-");

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await mkdir(join(workspaceRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(homeRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            debug: true,
            host: "codex",
            maxTokens: 128,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "hook-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(workspaceRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            enabled: "false",
            host: "codex",
            version: 1,
            workspaceId: "workspace-hook",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const result = await executeInstalledHostHook({
        command: "user-prompt-submit",
        host: "codex",
        homeRoot,
        payload: {
          cwd: workspaceRoot,
          prompt: "Check the release runbook before editing files.",
          session_id: "session-42",
        },
      });

      expect(result.applied).toBe(false);
      expect(result.reason).toBe("invalid_repo_config");
      expect(result.context).toBeNull();
      expect(result.output).toEqual({
        systemMessage: "GoodMemory codex user-prompt-submit hook skipped: invalid_repo_config.",
      });
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
  it("captures transcript_path stop payloads as per-turn writeback events", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-turnend-home-");
    const workspaceRoot = await createWorkspace("goodmemory-hook-turnend-workspace-");
    const rememberMessages: string[] = [];

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(homeRoot, ".goodmemory/claude.json"),
        JSON.stringify(
          {
            activationMode: "global",
            writeback: {
              mode: "selective",
            },
            debug: false,
            host: "claude",
            maxTokens: 128,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "hook-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      // A real Claude Code Stop payload: transcript by path, nothing inline.
      const transcriptPath = join(homeRoot, "session.jsonl");
      await writeFile(
        transcriptPath,
        JSON.stringify({
          cwd: workspaceRoot,
          message: {
            content: "Next step is to verify the per-turn capture path.",
            role: "user",
          },
          sessionId: "session-88",
          timestamp: "2026-07-05T10:00:00.000Z",
          type: "user",
          uuid: "uuid-turnend",
        }) + "\n",
        "utf8",
      );

      const result = await executeInstalledHostHook(
        {
          command: "session-stop",
          host: "claude",
          homeRoot,
          payload: {
            cwd: workspaceRoot,
            session_id: "session-88",
            stop_hook_active: false,
            transcript_path: transcriptPath,
          },
        },
        {
          createMemory: ((_: GoodMemoryConfig) =>
            ({
              jobs: createNoopGoodMemoryJobsFacade(),
              runtime: createNoopGoodMemoryRuntimeFacade(),
              async buildContext() {
                throw new Error("not used");
              },
              async recall() {
                throw new Error("not used");
              },
              async remember(input) {
                rememberMessages.push(input.messages[0]?.content ?? "");
                return {
                  accepted: 1,
                  events: [],
                  metadata: {
                    languagePackId: "en",
                    analysisMode: "rules-only",
                    locale: "en",
                    localeSource: "default",
                    requestedExtractionStrategy: "rules-only",
                    resolvedExtractionStrategy: "rules-only",
                  },
                  rejected: 0,
                };
              },
              async forget() {
                throw new Error("not used");
              },
              async importMemory() {
                throw new Error("importMemory is not implemented by this fake.");
              },
              async exportMemory() {
                throw new Error("not used");
              },
              async deleteAllMemory() {
                throw new Error("not used");
              },
              async feedback() {
                throw new Error("not used");
              },
              async reviseMemory() {
                throw new Error("not used");
              },
              async runMaintenance() {
                throw new Error("not used");
              },
            }) satisfies GoodMemory) as (config: GoodMemoryConfig) => GoodMemory,
        },
      );

      expect(result.reason).toBe("writeback_written");
      expect(result.writeback.wrote).toBe(true);
      expect(rememberMessages).toEqual([
        "Next step is to verify the per-turn capture path.",
      ]);

      // Per-turn Stop firings record honest per-turn provenance in the ledger.
      const ledger = await readInstalledHostWritebackLedger("claude", homeRoot);
      expect(ledger.auditEvents).toHaveLength(1);
      expect(ledger.auditEvents[0]?.command).toBe("turn-end");
      expect(ledger.auditEvents[0]?.status).toBe("committed");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
  it("plumbs the global retrieval config into createGoodMemory", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-retrieval-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-hook-retrieval-workspace-",
    );
    const received: Array<GoodMemoryConfig["retrieval"]> = [];

    const dependencies = {
      createMemory: ((config: GoodMemoryConfig) => {
        received.push(config.retrieval);
        return {
          jobs: createNoopGoodMemoryJobsFacade(),
          runtime: createNoopGoodMemoryRuntimeFacade(),
          async buildContext() {
            return {
              content: "notes",
              estimatedTokens: 1,
              omittedSections: [],
              output: "developer_prompt_fragment" as const,
            };
          },
          async recall() {
            return createRecallResult();
          },
          async remember() {
            throw new Error("not used");
          },
          async forget() {
            throw new Error("not used");
          },
          async importMemory() {
            throw new Error("importMemory is not implemented by this fake.");
          },
          async exportMemory() {
            throw new Error("not used");
          },
          async deleteAllMemory() {
            throw new Error("not used");
          },
          async feedback() {
            throw new Error("not used");
          },
          async reviseMemory() {
            throw new Error("not used");
          },
          async runMaintenance() {
            throw new Error("not used");
          },
        } satisfies GoodMemory;
      }) as (config: GoodMemoryConfig) => GoodMemory,
    };

    const writeConfig = async (retrieval?: Record<string, unknown>) =>
      writeFile(
        join(homeRoot, ".goodmemory/claude.json"),
        JSON.stringify(
          {
            activationMode: "global",
            host: "claude",
            maxTokens: 128,
            ...(retrieval ? { retrieval } : {}),
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "hook-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await writeConfig({ bm25Ranking: true, semanticCandidates: { topK: 16 } });

      const withRetrieval = await executeInstalledHostHook(
        {
          command: "user-prompt-submit",
          host: "claude",
          homeRoot,
          payload: {
            cwd: workspaceRoot,
            prompt: "What is the current focus?",
            session_id: "session-r1",
          },
        },
        dependencies,
      );
      expect(withRetrieval.applied).toBe(true);
      expect(received[0]).toEqual({
        bm25Ranking: true,
        semanticCandidates: { topK: 16 },
      });

      // Absence parity: configs without a retrieval section behave exactly
      // as today (no retrieval key reaches createGoodMemory).
      await writeConfig();
      await executeInstalledHostHook(
        {
          command: "user-prompt-submit",
          host: "claude",
          homeRoot,
          payload: {
            cwd: workspaceRoot,
            prompt: "What is the current focus?",
            session_id: "session-r2",
          },
        },
        dependencies,
      );
      expect(received[1]).toBeUndefined();
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
describe("installed host hook injection right-sizing", () => {
  interface FakeMemoryPlan {
    buildContextCalls: Array<{ maxTokens?: number }>;
    content: string;
    recallCalls: Array<{ query?: string }>;
    recallOverrides: Partial<RecallResult>;
  }

  function createPlannedMemory(plan: FakeMemoryPlan): (config: GoodMemoryConfig) => GoodMemory {
    return ((_: GoodMemoryConfig) =>
      ({
        jobs: createNoopGoodMemoryJobsFacade(),
        runtime: createNoopGoodMemoryRuntimeFacade(),
        async buildContext(input) {
          plan.buildContextCalls.push({ maxTokens: input.maxTokens });
          return {
            content: plan.content,
            estimatedTokens: 12,
            omittedSections: [],
            output: "developer_prompt_fragment" as const,
          };
        },
        async recall(input) {
          plan.recallCalls.push({ query: input.query });
          return createRecallResult(plan.recallOverrides);
        },
        async remember() {
          throw new Error("not used");
        },
        async forget() {
          throw new Error("not used");
        },
        async importMemory() {
          throw new Error("importMemory is not implemented by this fake.");
        },
        async exportMemory() {
          throw new Error("not used");
        },
        async deleteAllMemory() {
          throw new Error("not used");
        },
        async feedback() {
          throw new Error("not used");
        },
        async reviseMemory() {
          throw new Error("not used");
        },
        async runMaintenance() {
          throw new Error("not used");
        },
      }) satisfies GoodMemory) as (config: GoodMemoryConfig) => GoodMemory;
  }

  function lexicalHitOverrides(factId: string): Partial<RecallResult> {
    return {
      facts: [{ id: factId } as never],
      metadata: {
        ...createRecallResult().metadata,
        candidateTraces: [
          {
            fallback: false,
            intentScore: 0,
            lexicalScore: 0.5,
            memoryId: factId,
            memoryType: "fact",
            returned: true,
            slot: null,
          } as never,
        ],
      },
    };
  }

  async function writeInjectionHostConfig(input: {
    homeRoot: string;
    promptInjection?: string;
    sessionStartMaxTokens?: number;
  }): Promise<void> {
    await mkdir(join(input.homeRoot, ".goodmemory"), { recursive: true });
    await writeFile(
      join(input.homeRoot, ".goodmemory/claude.json"),
      JSON.stringify(
        {
          activationMode: "global",
          host: "claude",
          maxTokens: 512,
          ...(input.promptInjection
            ? { promptInjection: input.promptInjection }
            : {}),
          retrievalProfile: "coding_agent",
          ...(input.sessionStartMaxTokens
            ? { sessionStartMaxTokens: input.sessionStartMaxTokens }
            : {}),
          storage: {
            path: join(input.homeRoot, ".goodmemory/memory.sqlite"),
            provider: "sqlite",
          },
          userId: "injection-user",
          version: 1,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }

  it("gives the session-start brief its own budget", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-budget-home-");
    const workspaceRoot = await createWorkspace("goodmemory-hook-budget-workspace-");
    const plan: FakeMemoryPlan = {
      buildContextCalls: [],
      content: "Developer memory notes:\nbrief",
      recallCalls: [],
      recallOverrides: lexicalHitOverrides("fact-1"),
    };

    try {
      await writeInjectionHostConfig({ homeRoot, sessionStartMaxTokens: 1024 });
      const dependencies = { createMemory: createPlannedMemory(plan) };

      const sessionStart = await executeInstalledHostHook(
        {
          command: "session-start",
          host: "claude",
          homeRoot,
          payload: { cwd: workspaceRoot, session_id: "s-b1", source: "startup" },
        },
        dependencies,
      );
      expect(sessionStart.applied).toBe(true);
      expect(sessionStart.maxTokens).toBe(1024);
      expect(plan.buildContextCalls[0]?.maxTokens).toBe(1024);

      const promptSubmit = await executeInstalledHostHook(
        {
          command: "user-prompt-submit",
          host: "claude",
          homeRoot,
          payload: {
            cwd: workspaceRoot,
            prompt: "Where is the release runbook?",
            session_id: "s-b1",
          },
        },
        dependencies,
      );
      expect(promptSubmit.applied).toBe(true);
      expect(plan.buildContextCalls[1]?.maxTokens).toBe(512);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("skips low-relevance prompt injections when relevance gating is on", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-gate-home-");
    const workspaceRoot = await createWorkspace("goodmemory-hook-gate-workspace-");
    const plan: FakeMemoryPlan = {
      buildContextCalls: [],
      content: "Developer memory notes:\ncontinuity",
      recallCalls: [],
      recallOverrides: {},
    };

    try {
      await writeInjectionHostConfig({
        homeRoot,
        promptInjection: "relevance_gated",
      });

      const result = await executeInstalledHostHook(
        {
          command: "user-prompt-submit",
          host: "claude",
          homeRoot,
          payload: {
            cwd: workspaceRoot,
            prompt: "hello there",
            session_id: "s-g1",
          },
        },
        { createMemory: createPlannedMemory(plan) },
      );

      expect(result.applied).toBe(false);
      expect(result.reason).toBe("low_relevance");
      expect(result.output).toBeNull();
      // Session-start is never gated even with continuity-only recall.
      const sessionStart = await executeInstalledHostHook(
        {
          command: "session-start",
          host: "claude",
          homeRoot,
          payload: { cwd: workspaceRoot, session_id: "s-g1", source: "startup" },
        },
        { createMemory: createPlannedMemory(plan) },
      );
      expect(sessionStart.applied).toBe(true);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("suppresses duplicate prompt injections within a session and resets on compact", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-dedupe-home-");
    const workspaceRoot = await createWorkspace("goodmemory-hook-dedupe-workspace-");
    const plan: FakeMemoryPlan = {
      buildContextCalls: [],
      content: "Developer memory notes:\nrunbook fact",
      recallCalls: [],
      recallOverrides: lexicalHitOverrides("fact-1"),
    };

    try {
      await writeInjectionHostConfig({
        homeRoot,
        promptInjection: "relevance_gated",
      });
      const dependencies = { createMemory: createPlannedMemory(plan) };
      const payload = {
        cwd: workspaceRoot,
        prompt: "Where is the release runbook?",
        session_id: "s-d1",
      };

      const first = await executeInstalledHostHook(
        { command: "user-prompt-submit", host: "claude", homeRoot, payload },
        dependencies,
      );
      expect(first.applied).toBe(true);

      const second = await executeInstalledHostHook(
        { command: "user-prompt-submit", host: "claude", homeRoot, payload },
        dependencies,
      );
      expect(second.applied).toBe(false);
      expect(second.reason).toBe("duplicate_context");

      // New record set → injects again.
      plan.recallOverrides = lexicalHitOverrides("fact-2");
      plan.content = "Developer memory notes:\nnew fact";
      const third = await executeInstalledHostHook(
        { command: "user-prompt-submit", host: "claude", homeRoot, payload },
        dependencies,
      );
      expect(third.applied).toBe(true);

      // Without a reset, repeating the third fragment stays suppressed.
      const repeatBeforeCompact = await executeInstalledHostHook(
        { command: "user-prompt-submit", host: "claude", homeRoot, payload },
        dependencies,
      );
      expect(repeatBeforeCompact.reason).toBe("duplicate_context");

      // Post-compact session-start resets the dedupe state: content injected
      // before the compaction is welcome again in the fresh context window.
      plan.recallOverrides = lexicalHitOverrides("fact-brief");
      plan.content = "Developer memory notes:\nsession brief";
      await executeInstalledHostHook(
        {
          command: "session-start",
          host: "claude",
          homeRoot,
          payload: { cwd: workspaceRoot, session_id: "s-d1", source: "compact" },
        },
        dependencies,
      );
      plan.recallOverrides = lexicalHitOverrides("fact-2");
      plan.content = "Developer memory notes:\nnew fact";
      const afterCompact = await executeInstalledHostHook(
        { command: "user-prompt-submit", host: "claude", homeRoot, payload },
        dependencies,
      );
      expect(afterCompact.applied).toBe(true);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("keeps ungated prompt injection byte-compatible and enriches session-start queries", async () => {
    const homeRoot = await createWorkspace("goodmemory-hook-parity-home-");
    const workspaceRoot = await createWorkspace("goodmemory-hook-parity-workspace-");
    const plan: FakeMemoryPlan = {
      buildContextCalls: [],
      content: "Developer memory notes:\ncontinuity",
      recallCalls: [],
      recallOverrides: {},
    };

    try {
      await writeInjectionHostConfig({ homeRoot });
      const dependencies = { createMemory: createPlannedMemory(plan) };

      // No promptInjection config: continuity-only recall still injects.
      const prompt = await executeInstalledHostHook(
        {
          command: "user-prompt-submit",
          host: "claude",
          homeRoot,
          payload: {
            cwd: workspaceRoot,
            prompt: "hello there",
            session_id: "s-p1",
          },
        },
        dependencies,
      );
      expect(prompt.applied).toBe(true);

      // Session-start queries carry the workspace name as a lexical anchor.
      await executeInstalledHostHook(
        {
          command: "session-start",
          host: "claude",
          homeRoot,
          payload: { cwd: workspaceRoot, session_id: "s-p1", source: "resume" },
        },
        dependencies,
      );
      const sessionStartQuery = plan.recallCalls.at(-1)?.query ?? "";
      expect(sessionStartQuery).toContain("resume");
      expect(sessionStartQuery).toContain(basename(workspaceRoot));
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
describe("installed host shared-agent reads", () => {
  it("surfaces another host's records only when sharedAgents opts in", async () => {
    const homeRoot = await createWorkspace("goodmemory-shared-home-");
    const workspaceRoot = await createWorkspace("goodmemory-shared-workspace-");

    const writeClaudeConfig = async (sharedAgents?: string[]) =>
      writeFile(
        join(homeRoot, ".goodmemory/claude.json"),
        JSON.stringify(
          {
            activationMode: "global",
            host: "claude",
            maxTokens: 256,
            retrievalProfile: "coding_agent",
            ...(sharedAgents ? { sharedAgents } : {}),
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "shared-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await writeClaudeConfig();
      // Seed a codex-tagged fact through the real write pipeline against the
      // same shared sqlite store both hosts default to.
      const { createInstalledHostMemory: createMemoryForSeed } = await import(
        "../../src/install/hostExecutionContext"
      );
      const codexMemory = createMemoryForSeed({
        activationMode: "global",
        contextMode: "fragment",
        debug: false,
        host: "codex",
        maxTokens: 256,
        retrievalProfile: "coding_agent",
        scope: {
          agentId: "codex",
          userId: "shared-user",
          workspaceId: basename(workspaceRoot),
        },
        storage: {
          provider: "sqlite",
          url: join(homeRoot, ".goodmemory/memory.sqlite"),
        },
        writeback: {
          allowAssistantOutput: "confirmed_or_verified",
          dryRun: false,
          maxChars: 12_000,
          maxMessages: 12,
          minConfidence: 0.7,
          mode: "selective",
          persistRawTranscript: false,
        },
        workspaceRoot,
      });
      const seeded = await codexMemory.remember({
        annotations: [{ messageIndex: 0, remember: "always" }],
        messages: [
          {
            content: "The codex migration blocker is the shared schema review.",
            role: "user",
          },
        ],
        scope: {
          agentId: "codex",
          userId: "shared-user",
          workspaceId: basename(workspaceRoot),
        },
      });
      expect(seeded.accepted).toBe(1);

      const prompt = {
        cwd: workspaceRoot,
        prompt: "What is the codex migration blocker about the schema review?",
        session_id: "shared-session",
      };

      // Without sharedAgents: codex records stay private to codex.
      const siloed = await executeInstalledHostHook({
        command: "user-prompt-submit",
        host: "claude",
        homeRoot,
        payload: prompt,
      });
      expect(String(siloed.context ?? "")).not.toContain("schema review");

      // With sharedAgents ["codex"]: the read union surfaces it.
      await writeClaudeConfig(["codex"]);
      const shared = await executeInstalledHostHook({
        command: "user-prompt-submit",
        host: "claude",
        homeRoot,
        payload: prompt,
      });
      expect(shared.applied).toBe(true);
      expect(String(shared.context)).toContain("schema review");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
describe("installed host opportunistic maintenance", () => {
  it("runs the non-synthesizing job set on session-stop when enabled", async () => {
    const homeRoot = await createWorkspace("goodmemory-maintenance-home-");
    const workspaceRoot = await createWorkspace("goodmemory-maintenance-workspace-");
    const maintenanceCalls: Array<Record<string, unknown>> = [];

    const writeConfig = async (maintenance?: Record<string, unknown>) =>
      writeFile(
        join(homeRoot, ".goodmemory/claude.json"),
        JSON.stringify(
          {
            activationMode: "global",
            host: "claude",
            ...(maintenance ? { maintenance } : {}),
            maxTokens: 256,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "maintenance-user",
            version: 1,
            writeback: { mode: "off" },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

    const dependencies = {
      createMemory: ((_: GoodMemoryConfig) =>
        ({
          jobs: createNoopGoodMemoryJobsFacade(),
          runtime: createNoopGoodMemoryRuntimeFacade(),
          async buildContext() {
            throw new Error("not used");
          },
          async recall() {
            throw new Error("not used");
          },
          async remember() {
            throw new Error("not used");
          },
          async forget() {
            throw new Error("not used");
          },
          async importMemory() {
            throw new Error("importMemory is not implemented by this fake.");
          },
          async exportMemory() {
            throw new Error("not used");
          },
          async deleteAllMemory() {
            throw new Error("not used");
          },
          async feedback() {
            throw new Error("not used");
          },
          async reviseMemory() {
            throw new Error("not used");
          },
          async runMaintenance(input) {
            maintenanceCalls.push(input as unknown as Record<string, unknown>);
            return {
              compiledCount: 0,
              maintenance: null,
              promotionDecisionCounts: {},
              proposalCount: 0,
              ran: true,
              reason: "completed" as const,
            };
          },
        }) satisfies GoodMemory) as (config: GoodMemoryConfig) => GoodMemory,
    };

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });

      // Disabled (absent maintenance config): never called.
      await writeConfig();
      await executeInstalledHostHook(
        {
          command: "session-stop",
          host: "claude",
          homeRoot,
          payload: { cwd: workspaceRoot, session_id: "m-1" },
        },
        dependencies,
      );
      expect(maintenanceCalls).toHaveLength(0);

      // Enabled: runs after writeback with the pinned non-synthesizing jobs
      // (no consolidation) and the cooldown default.
      await writeConfig({ auto: true });
      await executeInstalledHostHook(
        {
          command: "session-stop",
          host: "claude",
          homeRoot,
          payload: { cwd: workspaceRoot, session_id: "m-1" },
        },
        dependencies,
      );
      expect(maintenanceCalls).toHaveLength(1);
      expect(maintenanceCalls[0]?.jobs).toEqual([
        "dedupe",
        "contradiction",
        "qualityRepair",
        "ttlExpiry",
      ]);
      expect(maintenanceCalls[0]?.minHoursBetweenRuns).toBe(24);
      expect(
        (maintenanceCalls[0]?.scope as Record<string, unknown>)?.sessionId,
      ).toBeUndefined();

      // Second stop inside the cooldown window passes the recorded mark.
      await executeInstalledHostHook(
        {
          command: "session-stop",
          host: "claude",
          homeRoot,
          payload: { cwd: workspaceRoot, session_id: "m-1" },
        },
        dependencies,
      );
      expect(maintenanceCalls).toHaveLength(2);
      expect(typeof maintenanceCalls[1]?.lastRunAt).toBe("string");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
