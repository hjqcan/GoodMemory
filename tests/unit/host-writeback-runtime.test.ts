import { describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  GoodMemory,
  GoodMemoryConfig,
} from "../../src/api/contracts";
import { attachGoodMemoryIntegrationSupport } from "../../src/api/integrationSupport";
import type {
  LanguageContentAnalysis,
  LanguagePack,
} from "../../src/language";
import {
  createEnglishLanguagePack,
  createLanguageService,
} from "../../src/language";
import {
  createNoopGoodMemoryJobsFacade,
  createNoopGoodMemoryRuntimeFacade,
} from "../../src/testing/fakes";
import {
  readInstalledHostWritebackLedger,
  withInstalledHostWritebackLedgerLock,
} from "../../src/install/hostWritebackAuditLedger";
import {
  executeInstalledHostWriteback,
  recordRememberToolWriteback,
} from "../../src/install/hostWritebackRuntime";

async function createWorkspace(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeHostConfig(input: {
  allowAssistantOutput?: "confirmed" | "confirmed_or_verified" | "never" | "verified";
  assistedExtractor?: boolean;
  defaultLocale?: string;
  dryRun?: boolean;
  homeRoot: string;
  maxChars?: number;
  mode: "off" | "observe" | "selective";
}): Promise<void> {
  await mkdir(join(input.homeRoot, ".goodmemory"), { recursive: true });
  await writeFile(
    join(input.homeRoot, ".goodmemory/codex.json"),
    JSON.stringify(
      {
        activationMode: "global",
        host: "codex",
        ...(input.defaultLocale
          ? { language: { defaultLocale: input.defaultLocale } }
          : {}),
        maxTokens: 128,
        retrievalProfile: "coding_agent",
        storage: {
          path: join(input.homeRoot, ".goodmemory/memory.sqlite"),
          provider: "sqlite",
        },
        userId: "phase37-user",
        version: 1,
        ...(input.assistedExtractor
          ? {
              providers: {
                assistedExtractor: {
                  apiKey: "test-key",
                  model: "gpt-4o-mini",
                  provider: "openai",
                },
              },
            }
          : {}),
        writeback: {
          ...(input.allowAssistantOutput
            ? { allowAssistantOutput: input.allowAssistantOutput }
            : {}),
          ...(input.dryRun !== undefined ? { dryRun: input.dryRun } : {}),
          ...(input.maxChars !== undefined ? { maxChars: input.maxChars } : {}),
          mode: input.mode,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

function createRememberingMemory(input: {
  configs?: GoodMemoryConfig[];
  rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]>;
}): (config: GoodMemoryConfig) => GoodMemory {
  return ((config: GoodMemoryConfig) => {
    input.configs?.push(config);
    return {
      jobs: createNoopGoodMemoryJobsFacade(),
      runtime: createNoopGoodMemoryRuntimeFacade(),
      async buildContext() {
        throw new Error("not used");
      },
      async recall() {
        throw new Error("not used");
      },
      async remember(rememberInput) {
        input.rememberCalls.push(rememberInput);
        return {
          accepted: 1,
          events: [],
          metadata: {
            analysisMode: "rules-only" as const,
            languagePackId: "test",
            locale: "en",
            localeSource: "default" as const,
            requestedExtractionStrategy: "rules-only" as const,
            resolvedExtractionStrategy: "rules-only" as const,
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
    } satisfies GoodMemory;
  }) as (config: GoodMemoryConfig) => GoodMemory;
}

describe("installed host writeback runtime", () => {
  it("uses the language service attached to the created memory for candidate admission", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-custom-language-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-custom-language-workspace-",
    );
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];
    let analyzeContentCalls = 0;
    let analyzedContent: LanguageContentAnalysis | undefined;
    let detectCalls = 0;
    let extractionAnalysis: LanguageContentAnalysis | undefined;
    let extractCandidatesCalls = 0;
    let providerCalls = 0;
    const english = createEnglishLanguagePack();
    const pack: LanguagePack = {
      ...english,
      analyzerVersion: "1",
      compatibilityGroup: "xx-test",
      defaultLocale: "xx-Test",
      detect({ texts }) {
        detectCalls += 1;
        return texts.some((text) => text.includes("zorbled"))
          ? "distinctive"
          : "none";
      },
      id: "xx-test",
      locales: ["xx-Test"],
      analyzeContent(text) {
        analyzeContentCalls += 1;
        analyzedContent = {
          ...english.analyzeContent(text),
          durableCue: text.includes("zorbled"),
        };
        return analyzedContent;
      },
      extractCandidates(input) {
        extractCandidatesCalls += 1;
        const message = input.messages[0];
        extractionAnalysis = message?.analysis;
        if (!message || !extractionAnalysis?.durableCue) {
          return [];
        }
        return [
          {
            content: message.content,
            explicitness: "explicit",
            id: input.nextId(),
            kindHint: "fact",
            sourceMessageIndex: message.sourceMessageIndex ?? 0,
            sourceRole: "user",
          },
        ];
      },
    };
    const language = createLanguageService({
      defaultLocale: "xx-Test",
      packs: [pack],
    });
    const createMemory = createRememberingMemory({ rememberCalls });

    try {
      await writeHostConfig({
        assistedExtractor: true,
        homeRoot,
        mode: "selective",
      });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [{ content: "zorbled", role: "user" }],
            session_id: "custom-language-session",
          },
        },
        {
          createMemory(config) {
            return attachGoodMemoryIntegrationSupport(createMemory(config), {
              language,
              async ingestAgentInputEvent() {
                return { recorded: false, skippedReason: "unsupported_memory" };
              },
              async ingestHostAgentEvent() {
                return { recorded: false, skippedReason: "unsupported_memory" };
              },
              async recordHostActionAssessment() {
                return { recorded: false, skippedReason: "unsupported_memory" };
              },
            });
          },
          createWritebackExtractor() {
            return {
              async extract() {
                providerCalls += 1;
                return {
                  candidates: [
                    {
                      content: "zorbled",
                      explicitness: "explicit",
                      id: "provider-zorbled",
                      kindHint: "fact",
                      sourceMessageIndex: 0,
                      sourceRole: "user",
                    },
                  ],
                  ignoredMessageCount: 0,
                };
              },
            };
          },
        },
      );

      expect(result).toMatchObject({ reason: "written", wrote: true });
      expect(rememberCalls[0]?.messages[0]?.content).toBe("zorbled");
      expect(extractionAnalysis).toBe(analyzedContent);
      expect({
        analyzeContentCalls,
        detectCalls,
        extractCandidatesCalls,
        providerCalls,
      }).toEqual({
        analyzeContentCalls: 1,
        detectCalls: 1,
        extractCandidatesCalls: 1,
        providerCalls: 1,
      });
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("uses every non-English built-in pack for providerless writeback", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-cjk-home-");
    const workspaceRoot = await createWorkspace("goodmemory-writeback-cjk-workspace-");
    const configs: GoodMemoryConfig[] = [];
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];

    try {
      await writeHostConfig({
        defaultLocale: "ja-jp",
        homeRoot,
        mode: "selective",
      });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [
              { content: "以后请优先使用简体中文回复。", role: "user" },
              { content: "以後請優先使用繁體中文回覆。", role: "user" },
              { content: "今後は箇条書きを優先してください。", role: "user" },
              { content: "항상 한국어로 답변해 주세요.", role: "user" },
              { content: "Toujours répondre en français.", role: "user" },
              { content: "Siempre responde en español.", role: "user" },
            ],
            session_id: "cjk-session",
          },
        },
        {
          createMemory: createRememberingMemory({ configs, rememberCalls }),
        },
      );

      expect(result).toMatchObject({ reason: "written", wrote: true });
      expect(result.candidates).toEqual([
        expect.objectContaining({
          content: "以后请优先使用简体中文回复。",
          durable: true,
        }),
        expect.objectContaining({
          content: "以後請優先使用繁體中文回覆。",
          durable: true,
        }),
        expect.objectContaining({
          content: "今後は箇条書きを優先してください。",
          durable: true,
        }),
        expect.objectContaining({
          content: "항상 한국어로 답변해 주세요.",
          durable: true,
        }),
        expect.objectContaining({
          content: "Toujours répondre en français.",
          durable: true,
        }),
        expect.objectContaining({
          content: "Siempre responde en español.",
          durable: true,
        }),
      ]);
      expect(rememberCalls.map((call) => call.messages[0]?.content)).toEqual([
        "以后请优先使用简体中文回复。",
        "以後請優先使用繁體中文回覆。",
        "今後は箇条書きを優先してください。",
        "항상 한국어로 답변해 주세요.",
        "Toujours répondre en français.",
        "Siempre responde en español.",
      ]);
      expect(
        rememberCalls.every((call) => call.extractionStrategy === "rules-only"),
      ).toBe(true);
      expect(configs[0]?.language).toEqual({ defaultLocale: "ja-JP" });
      expect(Object.isFrozen(configs[0]?.language)).toBe(true);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("keeps secret-like messages out of assisted extractor input", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-provider-secret-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-provider-secret-workspace-",
    );
    const extractorMessages: Array<Array<{ content: string; role: string }>> = [];
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];

    try {
      await writeHostConfig({ assistedExtractor: true, homeRoot, mode: "selective" });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [
              {
                content: "Remember api_key: sk-abcdefghijklmnopqrstuvwx for the bridge.",
                role: "user",
              },
              {
                content: "密碼：bridge-credential",
                role: "user",
              },
              {
                content: "パスワード: bridge-credential",
                role: "user",
              },
              {
                content: "Next step is to rotate the bridge credential.",
                role: "user",
              },
            ],
            session_id: "provider-secret-session",
          },
        },
        {
          createMemory: createRememberingMemory({ rememberCalls }),
          createWritebackExtractor: () => ({
            async extract(extractionInput) {
              extractorMessages.push(
                extractionInput.messages.map(({ content, role }) => ({
                  content,
                  role,
                })),
              );
              return { candidates: [], ignoredMessageCount: 0 };
            },
          }),
        },
      );

      expect(result.reason).toBe("written");
      expect(extractorMessages).toEqual([
        [
          {
            content: "Next step is to rotate the bridge credential.",
            role: "user",
          },
        ],
      ]);
      expect(result.candidates).toContainEqual(
        expect.objectContaining({
          content: "[redacted secret-like content]",
          durable: false,
          reason: "secret_blocked",
        }),
      );
      expect(
        result.candidates.filter(({ reason }) => reason === "secret_blocked"),
      ).toHaveLength(3);
      expect(rememberCalls).toHaveLength(1);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("returns disabled without reading transcript content when writeback is off", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-off-home-");
    const workspaceRoot = await createWorkspace("goodmemory-writeback-off-workspace-");

    try {
      await writeHostConfig({ homeRoot, mode: "off" });

      const result = await executeInstalledHostWriteback({
        command: "session-end",
        homeRoot,
        host: "codex",
        payload: {
          cwd: workspaceRoot,
          messages: [
            {
              content: "Always run typecheck before calling the phase done.",
              role: "user",
            },
          ],
          session_id: "session-1",
        },
      });

      expect(result).toMatchObject({
        applied: false,
        mode: "off",
        reason: "disabled",
        wrote: false,
      });
      expect(result.candidates).toEqual([]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("observes high-value candidates without writing durable memory", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-observe-home-");
    const workspaceRoot = await createWorkspace("goodmemory-writeback-observe-workspace-");
    let rememberCalled = false;

    try {
      await writeHostConfig({ homeRoot, mode: "observe" });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [
              {
                content: "Always run typecheck before calling the phase done.",
                role: "user",
              },
            ],
            session_id: "session-1",
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
                throw new Error("observe must not write");
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
      expect(result.mode).toBe("observe");
      expect(result.reason).toBe("observed");
      expect(result.wrote).toBe(false);
      expect(result.candidates).toEqual([
        expect.objectContaining({
          content: "Always run typecheck before calling the phase done.",
          durable: true,
          kind: "preference",
          source: "user",
        }),
      ]);
      expect(rememberCalled).toBe(false);
      expect(result.trace.rawTranscriptPersisted).toBe(false);
      expect(result.trace).toEqual(
        expect.objectContaining({
          auditWriteFailed: false,
          observedCandidateCount: 1,
        }),
      );
      const ledger = await readInstalledHostWritebackLedger("codex", homeRoot);
      expect(ledger.events).toEqual([]);
      expect(ledger.pending).toEqual([]);
      expect(ledger.version).toBe(4);
      expect(ledger.auditEvents).toEqual([
        expect.objectContaining({
          contentPreview: "Always run typecheck before calling the phase done.",
          linkedRecordIds: [],
          memoryIds: [],
          mode: "observe",
          status: "observed",
        }),
      ]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("treats an explicit repository project policy as a durable decision", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-project-policy-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-project-policy-workspace-",
    );

    try {
      await writeHostConfig({ homeRoot, mode: "observe" });
      const content =
        "Establish and implement the endpoint-display policy for this repository. Project policy: for endpoint display text, wrap a host containing a colon in one pair of parentheses unless it is already wrapped; leave other hosts unchanged.";
      const result = await executeInstalledHostWriteback({
        command: "turn-end",
        homeRoot,
        host: "codex",
        payload: {
          cwd: workspaceRoot,
          messages: [{ content, role: "user" }],
          session_id: "project-policy-session",
        },
      });

      expect(result).toMatchObject({
        reason: "observed",
        wrote: false,
      });
      expect(result.candidates).toEqual([
        expect.objectContaining({
          content,
          durable: true,
          kind: "fact",
          reason: "confirmed_decision",
          source: "user",
        }),
      ]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not turn policy questions or negations into confirmed decisions", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-policy-negative-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-policy-negative-workspace-",
    );

    try {
      await writeHostConfig({ homeRoot, mode: "observe" });
      for (const content of [
        "What is the project policy for deleting production data?",
        "There is no repository policy for deleting production data.",
        "Project policy is not defined.",
        "Project policy is what?",
        "Repository policy is under discussion.",
        "Project policy is unknown.",
        "Project policy is TBD.",
        "Repository policy is not finalized.",
        "Repository policy is being discussed.",
        "Project policy: TBD",
        "Project policy: requires clarification",
        "Project policy is to be determined.",
        "Project policy is that we have not decided.",
      ]) {
        const result = await executeInstalledHostWriteback({
          command: "turn-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [{ content, role: "user" }],
            session_id: `policy-negative-${content.length}`,
          },
        });
        expect(result.candidates).toEqual([]);
        expect(result.wrote).toBe(false);
      }
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("preserves English correction and technical-reference candidate semantics through the language pack", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-language-compat-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-language-compat-workspace-",
    );

    try {
      await writeHostConfig({ homeRoot, mode: "observe" });
      const messages = [
        "Correction: that approach was wrong.",
        "Next time use the compact format.",
        "From now on use bullet points.",
        "Use docs/README.md for this project.",
      ];
      const result = await executeInstalledHostWriteback({
        command: "turn-end",
        homeRoot,
        host: "codex",
        payload: {
          cwd: workspaceRoot,
          messages: messages.map((content) => ({ content, role: "user" })),
          session_id: "language-compat-session",
        },
      });

      expect(result.reason).toBe("observed");
      expect(result.candidates).toEqual([
        {
          confidence: 0.9,
          content: messages[0],
          durable: true,
          kind: "feedback",
          reason: "procedural_feedback",
          source: "user",
        },
        {
          confidence: 0.88,
          content: messages[1],
          durable: true,
          kind: "preference",
          reason: "explicit_preference",
          source: "user",
        },
        {
          confidence: 0.88,
          content: messages[2],
          durable: true,
          kind: "preference",
          reason: "explicit_preference",
          source: "user",
        },
        {
          confidence: 0.78,
          content: messages[3],
          durable: true,
          kind: "reference",
          reason: "stable_reference",
          source: "user",
        },
      ]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("distinguishes concise one-off and durable English directives", async () => {
    const homeRoot = await createWorkspace(
      "goodmemory-writeback-concise-english-home-",
    );
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-concise-english-workspace-",
    );

    try {
      await writeHostConfig({ homeRoot, mode: "observe" });
      const messages = [
        "Never use npm.",
        "Do not use npm.",
        "Please use bun.",
        "Remember to run smoke verification.",
      ];
      const result = await executeInstalledHostWriteback({
        command: "turn-end",
        homeRoot,
        host: "codex",
        payload: {
          cwd: workspaceRoot,
          messages: messages.map((content) => ({ content, role: "user" })),
          session_id: "concise-english-directives",
        },
      });

      expect(result.reason).toBe("observed");
      expect(result.candidates).toEqual(
        [messages[0], messages[3]].map((content) => ({
          confidence: 0.88,
          content,
          durable: true,
          kind: "preference",
          reason: "explicit_preference",
          source: "user",
        })),
      );
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("fails open when observe audit persistence fails", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-observe-audit-fail-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-observe-audit-fail-workspace-",
    );

    try {
      await writeHostConfig({ homeRoot, mode: "observe" });
      await mkdir(join(homeRoot, ".goodmemory/codex-writeback-events.json"), {
        recursive: true,
      });

      const result = await executeInstalledHostWriteback({
        command: "session-end",
        homeRoot,
        host: "codex",
        payload: {
          cwd: workspaceRoot,
          messages: [
            {
              content: "Always run typecheck before calling the phase done.",
              role: "user",
            },
          ],
          session_id: "session-1",
        },
      });

      expect(result.reason).toBe("audit_failed");
      expect(result.wrote).toBe(false);
      expect(result.trace).toEqual(
        expect.objectContaining({
          auditWriteFailed: true,
          observedCandidateCount: 0,
          rawTranscriptPersisted: false,
        }),
      );
      expect(result.candidates).toEqual([
        expect.objectContaining({
          content: "Always run typecheck before calling the phase done.",
          durable: true,
        }),
      ]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("treats managed dry-run as observe mode even when selective is configured", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-dry-run-home-");
    const workspaceRoot = await createWorkspace("goodmemory-writeback-dry-run-workspace-");
    let rememberCalled = false;

    try {
      await writeHostConfig({ dryRun: true, homeRoot, mode: "selective" });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [
              {
                content: "Next step is to add the phase-37 live report.",
                role: "user",
              },
            ],
            session_id: "session-1",
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
                throw new Error("dry-run must not write");
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

      expect(result.mode).toBe("observe");
      expect(result.reason).toBe("observed");
      expect(result.wrote).toBe(false);
      expect(rememberCalled).toBe(false);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("selectively writes candidates through the public remember surface", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-selective-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-selective-workspace-",
    );
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];

    try {
      await writeHostConfig({ homeRoot, mode: "selective" });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            event_id: "stop-1",
            messages: [
              {
                content: "Next step is to add the phase-37 live report.",
                role: "user",
              },
            ],
            session_id: "session-1",
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
                rememberCalls.push(input);
                return {
                  accepted: 1,
                  events: [],
                  metadata: {
                    languagePackId: "en",
                    analysisMode: "rules-only",
                    locale: "en",
                    localeSource: "default",
                    requestedExtractionStrategy: "llm-assisted",
                    resolvedExtractionStrategy: "llm-assisted",
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

      expect(result.reason).toBe("written");
      expect(result.wrote).toBe(true);
      expect(rememberCalls).toHaveLength(1);
      expect(rememberCalls[0]).toMatchObject({
        extractionStrategy: "rules-only",
        messages: [
          {
            content: "Next step is to add the phase-37 live report.",
            role: "user",
          },
        ],
        scope: {
          agentId: "codex",
          userId: "phase37-user",
        },
      });
      expect(rememberCalls[0]?.annotations).toEqual([
        expect.objectContaining({
          kindHint: "fact",
          messageIndex: 0,
          metadataPatch: {
            attributes: {
              hostWritebackAssistantPolicy: "confirmed_or_verified",
              hostWritebackCommand: "session-end",
              hostWritebackHost: "codex",
              hostWritebackMode: "selective",
              hostWritebackReason: "open_loop",
              hostWritebackSource: "user",
            },
            tags: ["installed-host-writeback"],
          },
          remember: "always",
        }),
      ]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("runs batch LLM extraction once and keeps the inner remember rules-only", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-provider-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-provider-workspace-",
    );
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];

    try {
      await writeHostConfig({
        assistedExtractor: true,
        homeRoot,
        mode: "selective",
      });

      const extractorWindows: Array<Array<{ content: string; role: string }>> = [];
      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [
              {
                content: "Next step is to add the phase-37 live report.",
                role: "user",
              },
              {
                content: "By the way our staging db moved to postgres 16.",
                role: "user",
              },
            ],
            session_id: "session-1",
          },
        },
        {
          // Hermetic batch extractor: sees the whole window in one call and
          // recovers a durable fact the regex floor cannot classify.
          createWritebackExtractor: () => ({
            async extract(input) {
              extractorWindows.push(
                input.messages.map((message) => ({ ...message })),
              );
              return {
                candidates: [
                  {
                    content: "The staging database is postgres 16.",
                    explicitness: "explicit" as const,
                    id: "batch-1",
                    kindHint: "fact" as const,
                    sourceMessageIndex: 1,
                    sourceRole: "user",
                  },
                ],
                ignoredMessageCount: 0,
              };
            },
          }),
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
                rememberCalls.push(input);
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

      expect(result.reason).toBe("written");
      // One extractor call over the whole bounded window.
      expect(extractorWindows).toHaveLength(1);
      expect(extractorWindows[0]).toHaveLength(2);
      expect(result.trace.batchExtraction).toBe("ok");
      // The batch stage already ran the LLM: the inner remember must not
      // trigger a second pass.
      expect(result.trace.extractionStrategy).toBe("rules-only");
      expect(rememberCalls.every((call) => call.extractionStrategy === "rules-only")).toBe(
        true,
      );
      // Both the regex open-loop and the batch-recovered fact land.
      const rememberedContents = rememberCalls.map(
        (call) => call.messages[0]?.content,
      );
      expect(rememberedContents).toContain(
        "Next step is to add the phase-37 live report.",
      );
      expect(rememberedContents).toContain("The staging database is postgres 16.");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("falls back to per-candidate llm-assisted when the batch extractor fails", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-batchfail-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-batchfail-workspace-",
    );
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];

    try {
      await writeHostConfig({
        assistedExtractor: true,
        homeRoot,
        mode: "selective",
      });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [
              {
                content: "Next step is to add the phase-37 live report.",
                role: "user",
              },
            ],
            session_id: "session-1",
          },
        },
        {
          createWritebackExtractor: () => ({
            async extract() {
              throw new Error("provider down");
            },
          }),
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
                rememberCalls.push(input);
                return {
                  accepted: 1,
                  events: [],
                  metadata: {
                    languagePackId: "en",
                    analysisMode: "rules-only",
                    locale: "en",
                    localeSource: "default",
                    requestedExtractionStrategy: "llm-assisted",
                    resolvedExtractionStrategy: "llm-assisted",
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

      // Rules floor still writes; the failed batch is visible in the trace
      // and the inner remember keeps today's llm-assisted path.
      expect(result.reason).toBe("written");
      expect(result.trace.batchExtraction).toBe("extractor_failed");
      expect(result.trace.extractionStrategy).toBe("llm-assisted");
      expect(rememberCalls[0]?.extractionStrategy).toBe("llm-assisted");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not hold the ledger lock while provider-backed remember runs", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-lock-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-lock-workspace-",
    );
    let acquiredLockDuringRemember = false;

    try {
      await writeHostConfig({ homeRoot, mode: "selective" });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [
              {
                content: "Next step is to verify provider-backed lock behavior.",
                role: "user",
              },
            ],
            session_id: "session-1",
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
                await withInstalledHostWritebackLedgerLock(
                  "codex",
                  homeRoot,
                  async () => {
                    acquiredLockDuringRemember = true;
                  },
                );
                return {
                  accepted: 1,
                  events: [
                    {
                      candidateId: "candidate-1",
                      evidenceIds: ["evidence-1"],
                      memoryId: "fact-1",
                      memoryType: "fact",
                      outcome: "written",
                    },
                  ],
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

      expect(result.reason).toBe("written");
      expect(acquiredLockDuringRemember).toBe(true);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("blocks unconfirmed assistant output before calling remember", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-assistant-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-assistant-workspace-",
    );
    let rememberCalled = false;

    try {
      await writeHostConfig({ homeRoot, mode: "selective" });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [
              {
                content: "We decided Codex is the canonical installed path.",
                role: "assistant",
              },
            ],
            session_id: "session-1",
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
                throw new Error("assistant should be blocked");
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

      expect(result.wrote).toBe(false);
      expect(result.reason).toBe("no_candidates");
      expect(result.candidates[0]).toMatchObject({
        durable: false,
        reason: "assistant_policy_blocked",
        source: "assistant",
      });
      expect(rememberCalled).toBe(false);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("parses string message role prefixes before applying assistant policy", async () => {
    const homeRoot = await createWorkspace(
      "goodmemory-writeback-string-assistant-home-",
    );
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-string-assistant-workspace-",
    );
    let rememberCalled = false;

    try {
      await writeHostConfig({ homeRoot, mode: "selective" });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [
              "assistant: We decided Codex is the canonical installed path.",
            ],
            session_id: "session-1",
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
                throw new Error("assistant string should be blocked");
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

      expect(result.reason).toBe("no_candidates");
      expect(result.wrote).toBe(false);
      expect(result.candidates).toEqual([
        expect.objectContaining({
          durable: false,
          reason: "assistant_policy_blocked",
          source: "assistant",
        }),
      ]);
      expect(rememberCalled).toBe(false);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("normalizes object message roles case-insensitively before assistant policy", async () => {
    const homeRoot = await createWorkspace(
      "goodmemory-writeback-object-assistant-home-",
    );
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-object-assistant-workspace-",
    );
    let rememberCalled = false;

    try {
      await writeHostConfig({ homeRoot, mode: "selective" });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [
              {
                content: "We decided Codex is the canonical installed path.",
                role: "Assistant",
              },
            ],
            session_id: "session-1",
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
                throw new Error("assistant object should be blocked");
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

      expect(result.reason).toBe("no_candidates");
      expect(result.candidates).toEqual([
        expect.objectContaining({
          durable: false,
          reason: "assistant_policy_blocked",
          source: "assistant",
        }),
      ]);
      expect(rememberCalled).toBe(false);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("ignores system, tool, and malformed roles instead of treating them as host events", async () => {
    const homeRoot = await createWorkspace(
      "goodmemory-writeback-unknown-role-home-",
    );
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-unknown-role-workspace-",
    );
    let rememberCalled = false;

    try {
      await writeHostConfig({ homeRoot, mode: "selective" });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [
              {
                content: "Next step is to add the phase-37 live report.",
                role: "system",
              },
              {
                content: "Next step is to add the phase-37 live report.",
                role: "tool",
              },
              {
                content: "Next step is to add the phase-37 live report.",
                role: "unexpected",
              },
              "system: Next step is to add the phase-37 live report.",
            ],
            session_id: "session-1",
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
                throw new Error("unknown roles must be ignored");
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

      expect(result).toMatchObject({
        reason: "empty_transcript",
        wrote: false,
      });
      expect(result.candidates).toEqual([]);
      expect(rememberCalled).toBe(false);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("blocks unconfirmed summaries as assistant output", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-summary-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-summary-workspace-",
    );
    let rememberCalled = false;

    try {
      await writeHostConfig({ homeRoot, mode: "selective" });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            session_id: "session-1",
            summary: "We decided Codex is the canonical installed path.",
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
                throw new Error("unconfirmed summary should be blocked");
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

      expect(result.reason).toBe("no_candidates");
      expect(result.wrote).toBe(false);
      expect(result.candidates).toEqual([
        expect.objectContaining({
          durable: false,
          reason: "assistant_policy_blocked",
          source: "assistant",
        }),
      ]);
      expect(rememberCalled).toBe(false);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("applies the configured assistant policy to confirmed summaries", async () => {
    const homeRoot = await createWorkspace(
      "goodmemory-writeback-summary-policy-home-",
    );
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-summary-policy-workspace-",
    );
    let rememberCalled = false;

    try {
      await writeHostConfig({
        allowAssistantOutput: "verified",
        homeRoot,
        mode: "selective",
      });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            session_id: "session-1",
            summary: "We decided Codex is the canonical installed path.",
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
                throw new Error("confirmed-only summary should be blocked");
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

      expect(result.reason).toBe("no_candidates");
      expect(result.wrote).toBe(false);
      expect(result.candidates).toEqual([
        expect.objectContaining({
          durable: false,
          reason: "assistant_policy_blocked",
          source: "assistant",
        }),
      ]);
      expect(rememberCalled).toBe(false);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("masks remember-never messages before writeback extraction", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-never-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-never-workspace-",
    );
    let rememberCalled = false;

    try {
      await writeHostConfig({ homeRoot, mode: "selective" });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            annotations: [
              {
                messageIndex: 0,
                remember: "never",
              },
            ],
            cwd: workspaceRoot,
            messages: [
              {
                content: "Always keep this private preference out of memory.",
                role: "user",
              },
            ],
            session_id: "session-1",
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
                throw new Error("remember-never should not write");
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

      expect(result.reason).toBe("no_candidates");
      expect(result.candidates).toEqual([]);
      expect(result.wrote).toBe(false);
      expect(rememberCalled).toBe(false);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("keeps tiny maxChars limits as hard content bounds", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-maxchars-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-maxchars-workspace-",
    );

    try {
      await writeHostConfig({ homeRoot, maxChars: 2, mode: "observe" });

      const result = await executeInstalledHostWriteback({
        command: "session-end",
        homeRoot,
        host: "codex",
        payload: {
          annotations: [
            {
              kindHint: "fact",
              messageIndex: 0,
              remember: "always",
            },
          ],
          cwd: workspaceRoot,
          messages: [
            {
              content:
                "Always keep this long raw transcript bounded before candidate extraction.",
              role: "user",
            },
          ],
          session_id: "session-1",
        },
      });

      expect(result.reason).toBe("observed");
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.content.length).toBeLessThanOrEqual(2);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("prioritizes the newest writeback signals when maxChars is exhausted", async () => {
    const homeRoot = await createWorkspace(
      "goodmemory-writeback-newest-budget-home-",
    );
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-newest-budget-workspace-",
    );

    try {
      await writeHostConfig({ homeRoot, maxChars: 27, mode: "observe" });

      const result = await executeInstalledHostWriteback({
        command: "session-end",
        homeRoot,
        host: "codex",
        payload: {
          cwd: workspaceRoot,
          messages: [
            {
              content:
                "Always keep this older long preference from exhausting the writeback budget before newer session-end signals are inspected.",
              role: "user",
            },
            {
              content: "Next step is phase-37 gate.",
              role: "user",
            },
          ],
          session_id: "session-1",
        },
      });

      expect(result.reason).toBe("observed");
      expect(result.candidates).toEqual([
        expect.objectContaining({
          content: "Next step is phase-37 gate.",
          reason: "open_loop",
        }),
      ]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not dedupe candidates rejected by the public remember surface", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-reject-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-reject-workspace-",
    );
    let rememberCallCount = 0;

    try {
      await writeHostConfig({ homeRoot, mode: "selective" });

      const input = {
        command: "session-end" as const,
        homeRoot,
        host: "codex" as const,
        payload: {
          cwd: workspaceRoot,
          event_id: "stop-1",
          messages: [
            {
              content: "Next step is to add the phase-37 live report.",
              role: "user",
            },
          ],
          session_id: "session-1",
        },
      };
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
              return {
                accepted: 0,
                events: [],
                rejected: 1,
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

      const first = await executeInstalledHostWriteback(input, dependencies);
      const second = await executeInstalledHostWriteback(input, dependencies);

      expect(first.reason).toBe("no_candidates");
      expect(first.wrote).toBe(false);
      expect(first.trace).toMatchObject({
        duplicateCandidateCount: 0,
        rejectedCandidateCount: 1,
        writtenCandidateCount: 0,
      });
      expect(first.candidates).toEqual([
        expect.objectContaining({
          durable: false,
          reason: "write_rejected",
        }),
      ]);
      expect(second.reason).toBe("no_candidates");
      expect(second.trace).toMatchObject({
        duplicateCandidateCount: 0,
        rejectedCandidateCount: 1,
        writtenCandidateCount: 0,
      });
      expect(rememberCallCount).toBe(2);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("uses bounded machine reasons in durable annotations when host reasons contain secrets", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-safe-reason-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-safe-reason-workspace-",
    );
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];

    try {
      await writeHostConfig({ homeRoot, mode: "selective" });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            annotations: [
              {
                kindHint: "fact",
                messageIndex: 0,
                reason: "api_key=sk-host-reason-secret-value",
                remember: "always",
              },
            ],
            cwd: workspaceRoot,
            messages: [
              {
                content: "Next step is to verify safe host annotation reasons.",
                role: "user",
              },
            ],
            session_id: "session-1",
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
                rememberCalls.push(input);
                return {
                  accepted: 1,
                  events: [
                    {
                      candidateId: "candidate-1",
                      evidenceIds: ["evidence-1"],
                      memoryId: "fact-1",
                      memoryType: "fact",
                      outcome: "written",
                    },
                  ],
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

      expect(result.reason).toBe("written");
      expect(result.candidates[0]).toEqual(
        expect.objectContaining({
          reason: "host_annotation",
        }),
      );
      expect(JSON.stringify(rememberCalls)).not.toContain("sk-host-reason-secret-value");
      expect(rememberCalls[0]?.annotations?.[0]).toEqual(
        expect.objectContaining({
          metadataPatch: {
            attributes: expect.objectContaining({
              hostWritebackReason: "host_annotation",
            }),
            tags: ["installed-host-writeback"],
          },
          reason: "GoodMemory installed-host writeback: host_annotation",
        }),
      );
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("dedupes repeated candidates inside the same writeback payload", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-same-batch-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-same-batch-workspace-",
    );
    let rememberCallCount = 0;

    try {
      await writeHostConfig({ homeRoot, mode: "selective" });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [
              {
                content: "Next step is to add Phase 37.1 audit undo.",
                role: "user",
              },
              {
                content: "Next step is to add Phase 37.1 audit undo.",
                role: "user",
              },
            ],
            session_id: "session-1",
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
                rememberCallCount += 1;
                return {
                  accepted: 1,
                  events: [
                    {
                      candidateId: "candidate-1",
                      evidenceIds: ["evidence-1"],
                      memoryId: "fact-1",
                      memoryType: "fact",
                      outcome: "written",
                    },
                  ],
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

      expect(result.reason).toBe("written");
      expect(result.trace).toMatchObject({
        duplicateCandidateCount: 1,
        writtenCandidateCount: 1,
      });
      expect(rememberCallCount).toBe(1);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not dedupe the same candidate across different installed-host scopes", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-scoped-dedupe-home-");
    const workspaceOne = await createWorkspace(
      "goodmemory-writeback-scoped-dedupe-one-",
    );
    const workspaceTwo = await createWorkspace(
      "goodmemory-writeback-scoped-dedupe-two-",
    );
    let rememberCallCount = 0;

    try {
      await writeHostConfig({ homeRoot, mode: "selective" });
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
              return {
                accepted: 1,
                events: [
                  {
                    candidateId: `candidate-${rememberCallCount}`,
                    evidenceIds: [`evidence-${rememberCallCount}`],
                    memoryId: `fact-${rememberCallCount}`,
                    memoryType: "fact",
                    outcome: "written",
                  },
                ],
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

      const first = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceOne,
            messages: [
              {
                content: "Next step is to add Phase 37.1 audit undo.",
                role: "user",
              },
            ],
            session_id: "session-1",
          },
        },
        dependencies,
      );
      const second = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceTwo,
            messages: [
              {
                content: "Next step is to add Phase 37.1 audit undo.",
                role: "user",
              },
            ],
            session_id: "session-2",
          },
        },
        dependencies,
      );
      const ledger = await readInstalledHostWritebackLedger("codex", homeRoot);

      expect(first.reason).toBe("written");
      expect(second.reason).toBe("written");
      expect(rememberCallCount).toBe(2);
      expect(ledger.events).toHaveLength(2);
      expect(new Set(ledger.events).size).toBe(2);
      expect(ledger.events.every((event) => event.startsWith("scope:"))).toBe(true);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceOne, { force: true, recursive: true });
      await rm(workspaceTwo, { force: true, recursive: true });
    }
  });

  it("does not mark merged pre-existing memories as writeback-owned undo targets", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-merged-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-merged-workspace-",
    );

    try {
      await writeHostConfig({ homeRoot, mode: "selective" });

      await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [
              {
                content: "Next step is to add Phase 37.1 audit undo.",
                role: "user",
              },
            ],
            session_id: "session-1",
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
                return {
                  accepted: 1,
                  events: [
                    {
                      candidateId: "candidate-1",
                      evidenceIds: ["writeback-evidence-1"],
                      memoryId: "pre-existing-fact-1",
                      memoryType: "fact",
                      outcome: "merged",
                    },
                  ],
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

      const ledger = await readInstalledHostWritebackLedger("codex", homeRoot);

      expect(ledger.auditEvents[0]?.memoryIds).toEqual([]);
      expect(ledger.auditEvents[0]?.linkedRecordIds).toEqual([
        {
          id: "writeback-evidence-1",
          type: "evidence",
        },
      ]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("records accepted writes in the ledger before returning a partial failure", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-partial-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-partial-workspace-",
    );
    const rememberContents: string[] = [];
    let failOpenLoopOnce = true;

    try {
      await writeHostConfig({ homeRoot, mode: "selective" });

      const input = {
        command: "session-end" as const,
        homeRoot,
        host: "codex" as const,
        payload: {
          cwd: workspaceRoot,
          event_id: "stop-1",
          messages: [
            {
              content: "Always run typecheck before calling the phase done.",
              role: "user",
            },
            {
              content: "Next step is to add the phase-37 live report.",
              role: "user",
            },
          ],
          session_id: "session-1",
        },
      };
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
            async remember(input) {
              const content = input.messages[0]?.content ?? "";
              rememberContents.push(content);
              if (content.startsWith("Next step") && failOpenLoopOnce) {
                failOpenLoopOnce = false;
                throw new Error("transient remember failure");
              }

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

      const first = await executeInstalledHostWriteback(input, dependencies);
      const second = await executeInstalledHostWriteback(input, dependencies);

      expect(first.reason).toBe("write_failed");
      expect(first.wrote).toBe(true);
      expect(first.trace).toMatchObject({
        failedCandidateCount: 1,
        writtenCandidateCount: 1,
      });
      expect(first.candidates).toEqual([
        expect.objectContaining({
          durable: true,
          reason: "explicit_preference",
        }),
        expect.objectContaining({
          durable: false,
          reason: "write_failed",
        }),
      ]);
      expect(second.reason).toBe("written");
      expect(second.trace).toMatchObject({
        duplicateCandidateCount: 1,
        writtenCandidateCount: 1,
      });
      expect(rememberContents).toEqual([
        "Always run typecheck before calling the phase done.",
        "Next step is to add the phase-37 live report.",
        "Next step is to add the phase-37 live report.",
      ]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("records failed audit status when remember fails before accepting", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-audit-failed-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-audit-failed-workspace-",
    );

    try {
      await writeHostConfig({ homeRoot, mode: "selective" });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [
              {
                content: "Next step is to record failed audit status.",
                role: "user",
              },
            ],
            session_id: "session-1",
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
                throw new Error("remember failed before accepting");
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

      const ledger = await readInstalledHostWritebackLedger("codex", homeRoot);

      expect(result.reason).toBe("write_failed");
      expect(result.wrote).toBe(false);
      expect(ledger.events).toEqual([]);
      expect(ledger.pending).toEqual([]);
      expect(ledger.auditEvents[0]).toEqual(
        expect.objectContaining({
          errorCode: "remember_failed",
          sessionDigest: expect.stringMatching(/^session:/u),
          status: "failed",
        }),
      );
      expect(ledger.auditEvents[0]?.sessionDigest).not.toBe("session-1");
      expect(JSON.stringify(ledger)).not.toContain("session-1");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("keeps a pending ledger record when commit persistence fails after remember accepts", async () => {
    const homeRoot = await createWorkspace(
      "goodmemory-writeback-ledger-fail-home-",
    );
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-ledger-fail-workspace-",
    );
    let rememberCallCount = 0;

    try {
      await writeHostConfig({ homeRoot, mode: "selective" });

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [
              {
                content: "Next step is to add the phase-37 live report.",
                role: "user",
              },
            ],
            session_id: "session-1",
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
                rememberCallCount += 1;
                await chmod(
                  join(homeRoot, ".goodmemory/codex-writeback-events.json"),
                  0o400,
                );
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

      expect(result.reason).toBe("write_failed");
      expect(result.wrote).toBe(true);
      expect(result.trace).toMatchObject({
        failedCandidateCount: 1,
        uncommittedCandidateCount: 1,
        writtenCandidateCount: 0,
      });
      expect(result.candidates).toEqual([
        expect.objectContaining({
          durable: true,
          reason: "ledger_pending",
        }),
      ]);
      expect(
        JSON.parse(
          await readFile(
            join(homeRoot, ".goodmemory/codex-writeback-events.json"),
            "utf8",
          ),
        ),
      ).toMatchObject({
        auditEvents: [
          expect.objectContaining({
            status: "pending",
          }),
        ],
        events: [],
        pending: [expect.stringMatching(/^scope:[a-f0-9]+:candidate:/u)],
        version: 4,
      });
      expect(rememberCallCount).toBe(1);

      const retryResult = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [
              {
                content: "Next step is to add the phase-37 live report.",
                role: "user",
              },
            ],
            session_id: "session-2",
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
                rememberCallCount += 1;
                throw new Error("pending writeback key must not be retried");
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

      expect(retryResult).toMatchObject({
        reason: "no_candidates",
        wrote: false,
      });
      expect(retryResult.trace).toMatchObject({
        duplicateCandidateCount: 1,
        writtenCandidateCount: 0,
      });
      expect(retryResult.candidates).toEqual([
        expect.objectContaining({
          durable: false,
          reason: "duplicate",
        }),
      ]);
      expect(rememberCallCount).toBe(1);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

// Stop/SessionEnd hook payloads from Claude Code carry transcript_path (a
// session JSONL file) and no inline messages. Hydration turns that path into
// the bounded message window the pipeline already governs; inline payloads
// always win, and the per-session cursor keeps per-turn work incremental.
describe("installed host writeback transcript hydration", () => {
  async function writeClaudeHostConfig(input: {
    assistedExtractor?: boolean;
    homeRoot: string;
    mode: "off" | "observe" | "selective";
  }): Promise<void> {
    await mkdir(join(input.homeRoot, ".goodmemory"), { recursive: true });
    await writeFile(
      join(input.homeRoot, ".goodmemory/claude.json"),
      JSON.stringify(
        {
          activationMode: "global",
          host: "claude",
          maxTokens: 128,
          retrievalProfile: "coding_agent",
          storage: {
            path: join(input.homeRoot, ".goodmemory/memory.sqlite"),
            provider: "sqlite",
          },
          userId: "hydration-user",
          version: 1,
          ...(input.assistedExtractor
            ? {
                providers: {
                  assistedExtractor: {
                    apiKey: "test-key",
                    model: "gpt-4o-mini",
                    provider: "openai",
                  },
                },
              }
            : {}),
          writeback: {
            allowAssistantOutput: "confirmed_or_verified",
            dryRun: false,
            maxChars: 12_000,
            maxMessages: 12,
            minConfidence: 0.7,
            mode: input.mode,
            persistRawTranscript: false,
          },
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  function transcriptUserLine(content: string): string {
    return JSON.stringify({
      cwd: "/tmp/project",
      message: { content, role: "user" },
      sessionId: "hydration-session",
      timestamp: "2026-07-05T10:00:00.000Z",
      type: "user",
      uuid: `uuid-${content.length}`,
    });
  }

  function transcriptAssistantLine(text: string): string {
    return JSON.stringify({
      cwd: "/tmp/project",
      message: {
        content: [{ text, type: "text" }],
        model: "claude-fable-5",
        role: "assistant",
      },
      sessionId: "hydration-session",
      timestamp: "2026-07-05T10:00:01.000Z",
      type: "assistant",
      uuid: `uuid-a-${text.length}`,
    });
  }

  function createHydrationMemory(input: {
    onRemember?: (call: Parameters<GoodMemory["remember"]>[0]) => Promise<void> | void;
    rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]>;
  }): (config: GoodMemoryConfig) => GoodMemory {
    return ((_: GoodMemoryConfig) =>
      ({
        jobs: createNoopGoodMemoryJobsFacade(),
        runtime: createNoopGoodMemoryRuntimeFacade(),
        async buildContext() {
          throw new Error("not used");
        },
        async recall() {
          throw new Error("not used");
        },
        async remember(rememberInput) {
          input.rememberCalls.push(rememberInput);
          if (input.onRemember) {
            await input.onRemember(rememberInput);
          }
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
      }) satisfies GoodMemory) as (config: GoodMemoryConfig) => GoodMemory;
  }

  it("hydrates transcript_path payloads and writes durable user candidates", async () => {
    const homeRoot = await createWorkspace("goodmemory-hydration-home-");
    const workspaceRoot = await createWorkspace("goodmemory-hydration-workspace-");
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];

    try {
      await writeClaudeHostConfig({ homeRoot, mode: "selective" });
      const transcriptPath = join(homeRoot, "session.jsonl");
      await writeFile(
        transcriptPath,
        transcriptUserLine(
          "Next step is to wire the transcript hydration report.",
        ) + "\n",
        "utf8",
      );

      const result = await executeInstalledHostWriteback(
        {
          command: "turn-end",
          homeRoot,
          host: "claude",
          payload: {
            cwd: workspaceRoot,
            session_id: "hydration-session",
            transcript_path: transcriptPath,
          },
        },
        { createMemory: createHydrationMemory({ rememberCalls }) },
      );

      expect(result.reason).toBe("written");
      expect(result.wrote).toBe(true);
      expect(result.trace).toMatchObject({
        rawTranscriptPersisted: false,
        transcriptDeltaMessageCount: 1,
        transcriptPathUsed: true,
        transcriptReadStatus: "ok",
        transcriptSessionDigest: expect.stringMatching(/^session:[a-f0-9]{24}$/u),
      });
      expect(rememberCalls).toHaveLength(1);
      expect(rememberCalls[0]?.messages).toEqual([
        {
          content: "Next step is to wire the transcript hydration report.",
          role: "user",
        },
      ]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("filters acknowledgement-only tails before bounding hydrated writeback messages", async () => {
    const homeRoot = await createWorkspace("goodmemory-hydration-ack-tail-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-hydration-ack-tail-workspace-",
    );
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];

    try {
      await writeClaudeHostConfig({ homeRoot, mode: "selective" });
      const transcriptPath = join(homeRoot, "session.jsonl");
      await writeFile(
        transcriptPath,
        [
          transcriptUserLine("Next step is to preserve the durable migration plan."),
          ...Array.from({ length: 12 }, () => transcriptUserLine("ok")),
        ].join("\n") + "\n",
        "utf8",
      );

      const result = await executeInstalledHostWriteback(
        {
          command: "turn-end",
          homeRoot,
          host: "claude",
          payload: {
            cwd: workspaceRoot,
            session_id: "hydration-ack-tail-session",
            transcript_path: transcriptPath,
          },
        },
        { createMemory: createHydrationMemory({ rememberCalls }) },
      );

      expect(result).toMatchObject({ reason: "written", wrote: true });
      expect(result.trace).toMatchObject({
        transcriptCursorAdvanced: true,
        transcriptDeltaMessageCount: 12,
      });
      expect(rememberCalls.map((call) => call.messages[0]?.content)).toEqual([
        "Next step is to preserve the durable migration plan.",
      ]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("advances the hydration cursor only through the oldest bounded message chunk", async () => {
    const homeRoot = await createWorkspace("goodmemory-hydration-chunk-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-hydration-chunk-workspace-",
    );
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];

    try {
      await writeClaudeHostConfig({ homeRoot, mode: "selective" });
      const transcriptPath = join(homeRoot, "session.jsonl");
      await writeFile(
        transcriptPath,
        [
          transcriptUserLine("Next step is to retain the durable head instruction."),
          ...Array.from({ length: 12 }, () => transcriptUserLine("sounds good")),
        ].join("\n") + "\n",
        "utf8",
      );
      const input = {
        command: "turn-end" as const,
        homeRoot,
        host: "claude" as const,
        payload: {
          cwd: workspaceRoot,
          prompt: "sounds good",
          session_id: "hydration-bounded-chunk-session",
          summary: "sounds good",
          transcript_path: transcriptPath,
        },
      };
      const dependencies = {
        createMemory: createHydrationMemory({ rememberCalls }),
      };

      const first = await executeInstalledHostWriteback(input, dependencies);
      expect(first).toMatchObject({ reason: "written", wrote: true });
      expect(first.trace).toMatchObject({
        transcriptCursorAdvanced: true,
        transcriptDeltaMessageCount: 12,
      });
      expect(rememberCalls.map((call) => call.messages[0]?.content)).toEqual([
        "Next step is to retain the durable head instruction.",
      ]);

      const remaining = await executeInstalledHostWriteback(input, dependencies);
      expect(remaining).toMatchObject({ reason: "no_candidates", wrote: false });
      expect(remaining.trace).toMatchObject({
        transcriptCursorAdvanced: true,
        transcriptDeltaMessageCount: 1,
      });

      const consumed = await executeInstalledHostWriteback(input, dependencies);
      expect(consumed).toMatchObject({ reason: "empty_transcript", wrote: false });
      expect(consumed.trace).toMatchObject({ transcriptDeltaMessageCount: 0 });
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("fails explicitly and retains the cursor when a Codex rollout shape drifts", async () => {
    const homeRoot = await createWorkspace("goodmemory-codex-drift-home-");
    const workspaceRoot = await createWorkspace("goodmemory-codex-drift-workspace-");
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];

    try {
      await writeHostConfig({ homeRoot, mode: "selective" });
      const transcriptPath = join(homeRoot, "rollout.jsonl");
      await writeFile(
        transcriptPath,
        [
          JSON.stringify({
            payload: {
              content: "changed wire shape",
              role: "user",
              type: "message",
            },
            timestamp: "2026-07-15T10:00:00.000Z",
            type: "response_item",
          }),
          JSON.stringify({
            payload: {
              content: [{ text: "Next step must not be consumed.", type: "input_text" }],
              role: "user",
              type: "message",
            },
            timestamp: "2026-07-15T10:00:01.000Z",
            type: "response_item",
          }),
        ].join("\n") + "\n",
        "utf8",
      );
      const payload = {
        cwd: workspaceRoot,
        session_id: "codex-drift-session",
        transcript_path: transcriptPath,
      };
      const dependencies = { createMemory: createHydrationMemory({ rememberCalls }) };

      const first = await executeInstalledHostWriteback(
        { command: "turn-end", homeRoot, host: "codex", payload },
        dependencies,
      );
      const second = await executeInstalledHostWriteback(
        { command: "turn-end", homeRoot, host: "codex", payload },
        dependencies,
      );

      for (const result of [first, second]) {
        expect(result.reason).toBe("transcript_read_failed");
        expect(result.trace).toMatchObject({
          transcriptFormatDrift: {
            byteOffset: 0,
            reason: "response_item message content must be an array",
          },
          transcriptPathUsed: true,
          transcriptReadStatus: "format_drift",
        });
      }
      expect(rememberCalls).toEqual([]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("prefers inline messages over transcript_path", async () => {
    const homeRoot = await createWorkspace("goodmemory-hydration-inline-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-hydration-inline-workspace-",
    );
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];

    try {
      await writeClaudeHostConfig({ homeRoot, mode: "selective" });

      const result = await executeInstalledHostWriteback(
        {
          command: "turn-end",
          homeRoot,
          host: "claude",
          payload: {
            cwd: workspaceRoot,
            messages: [
              {
                content: "Next step is to keep inline payloads authoritative.",
                role: "user",
              },
            ],
            session_id: "hydration-session",
            transcript_path: join(homeRoot, "does-not-exist.jsonl"),
          },
        },
        { createMemory: createHydrationMemory({ rememberCalls }) },
      );

      expect(result.reason).toBe("written");
      expect(result.trace.transcriptPathUsed).toBeUndefined();
      expect(rememberCalls[0]?.messages?.[0]?.content).toBe(
        "Next step is to keep inline payloads authoritative.",
      );
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("stays disabled without touching the transcript when writeback is off", async () => {
    const homeRoot = await createWorkspace("goodmemory-hydration-off-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-hydration-off-workspace-",
    );

    try {
      await writeClaudeHostConfig({ homeRoot, mode: "off" });
      const transcriptPath = join(homeRoot, "session.jsonl");
      await writeFile(
        transcriptPath,
        transcriptUserLine("Next step is invisible while writeback is off.") + "\n",
        "utf8",
      );

      const result = await executeInstalledHostWriteback(
        {
          command: "turn-end",
          homeRoot,
          host: "claude",
          payload: {
            cwd: workspaceRoot,
            session_id: "hydration-session",
            transcript_path: transcriptPath,
          },
        },
        {},
      );

      expect(result.reason).toBe("disabled");
      expect(result.trace.transcriptPathUsed).toBeUndefined();
      expect(result.trace.transcriptReadStatus).toBeUndefined();
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("processes only the delta on repeated runs and resumes after appends", async () => {
    const homeRoot = await createWorkspace("goodmemory-hydration-delta-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-hydration-delta-workspace-",
    );
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];
    const dependencies = { createMemory: createHydrationMemory({ rememberCalls }) };

    try {
      await writeClaudeHostConfig({ homeRoot, mode: "selective" });
      const transcriptPath = join(homeRoot, "session.jsonl");
      await writeFile(
        transcriptPath,
        transcriptUserLine("Next step is the first hydrated capture.") + "\n",
        "utf8",
      );
      const payload = {
        cwd: workspaceRoot,
        session_id: "hydration-session",
        transcript_path: transcriptPath,
      };

      const first = await executeInstalledHostWriteback(
        { command: "turn-end", homeRoot, host: "claude", payload },
        dependencies,
      );
      expect(first.reason).toBe("written");
      expect(rememberCalls).toHaveLength(1);

      const second = await executeInstalledHostWriteback(
        { command: "turn-end", homeRoot, host: "claude", payload },
        dependencies,
      );
      expect(second.reason).toBe("empty_transcript");
      expect(second.trace).toMatchObject({
        transcriptDeltaMessageCount: 0,
        transcriptPathUsed: true,
        transcriptReadStatus: "ok",
      });
      expect(rememberCalls).toHaveLength(1);

      await writeFile(
        transcriptPath,
        transcriptUserLine("Next step is to capture the appended turn only.") + "\n",
        { flag: "a" },
      );
      const third = await executeInstalledHostWriteback(
        { command: "turn-end", homeRoot, host: "claude", payload },
        dependencies,
      );
      expect(third.reason).toBe("written");
      expect(rememberCalls).toHaveLength(2);
      expect(rememberCalls[1]?.messages?.[0]?.content).toBe(
        "Next step is to capture the appended turn only.",
      );
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not let an older concurrent Stop regress the transcript cursor", async () => {
    const homeRoot = await createWorkspace(
      "goodmemory-hydration-concurrent-cursor-home-",
    );
    const workspaceRoot = await createWorkspace(
      "goodmemory-hydration-concurrent-cursor-workspace-",
    );
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];
    let releaseFirstExtraction: (() => void) | undefined;
    let signalFirstExtraction: (() => void) | undefined;
    const firstExtractionStarted = new Promise<void>((resolve) => {
      signalFirstExtraction = resolve;
    });
    const firstExtractionReleased = new Promise<void>((resolve) => {
      releaseFirstExtraction = resolve;
    });
    let extractionAttempt = 0;
    const dependencies = {
      createMemory: createHydrationMemory({ rememberCalls }),
      createWritebackExtractor: () => ({
        async extract() {
          extractionAttempt += 1;
          if (extractionAttempt !== 1) {
            return { candidates: [], ignoredMessageCount: 0 };
          }
          signalFirstExtraction?.();
          await firstExtractionReleased;
          return { candidates: [], ignoredMessageCount: 0 };
        },
      }),
    };

    try {
      await writeClaudeHostConfig({
        assistedExtractor: true,
        homeRoot,
        mode: "selective",
      });
      const transcriptPath = join(homeRoot, "session.jsonl");
      await writeFile(
        transcriptPath,
        transcriptUserLine("Next step is the slower first cursor commit.") + "\n",
        "utf8",
      );
      const payload = {
        cwd: workspaceRoot,
        session_id: "hydration-concurrent-session",
        transcript_path: transcriptPath,
      };

      const older = executeInstalledHostWriteback(
        { command: "turn-end", homeRoot, host: "claude", payload },
        dependencies,
      );
      await firstExtractionStarted;

      await writeFile(
        transcriptPath,
        transcriptUserLine("Next step is the newer complete cursor commit.") + "\n",
        { flag: "a" },
      );
      const newer = await executeInstalledHostWriteback(
        { command: "turn-end", homeRoot, host: "claude", payload },
        dependencies,
      );
      expect(newer.trace).toMatchObject({
        transcriptCursorAdvanced: true,
        transcriptDeltaMessageCount: 2,
      });

      releaseFirstExtraction?.();
      const stale = await older;
      expect(stale.trace.transcriptCursorAdvanced).toBe(false);

      const consumed = await executeInstalledHostWriteback(
        { command: "turn-end", homeRoot, host: "claude", payload },
        dependencies,
      );
      expect(consumed).toMatchObject({
        reason: "empty_transcript",
        trace: { transcriptDeltaMessageCount: 0 },
      });
    } finally {
      releaseFirstExtraction?.();
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not advance past a candidate owned by an in-flight Stop", async () => {
    const homeRoot = await createWorkspace(
      "goodmemory-hydration-pending-candidate-home-",
    );
    const workspaceRoot = await createWorkspace(
      "goodmemory-hydration-pending-candidate-workspace-",
    );
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];
    let releaseFirstRemember: (() => void) | undefined;
    let signalFirstRemember: (() => void) | undefined;
    const firstRememberStarted = new Promise<void>((resolve) => {
      signalFirstRemember = resolve;
    });
    const firstRememberReleased = new Promise<void>((resolve) => {
      releaseFirstRemember = resolve;
    });
    let rememberAttempt = 0;
    const dependencies = {
      createMemory: createHydrationMemory({
        async onRemember() {
          rememberAttempt += 1;
          if (rememberAttempt !== 1) {
            return;
          }
          signalFirstRemember?.();
          await firstRememberReleased;
          throw new Error("the original Stop failed after reserving its candidate");
        },
        rememberCalls,
      }),
    };

    try {
      await writeClaudeHostConfig({ homeRoot, mode: "selective" });
      const transcriptPath = join(homeRoot, "session.jsonl");
      const firstContent = "Next step is the in-flight candidate that must retry.";
      await writeFile(
        transcriptPath,
        transcriptUserLine(firstContent) + "\n",
        "utf8",
      );
      const payload = {
        cwd: workspaceRoot,
        session_id: "hydration-pending-candidate-session",
        transcript_path: transcriptPath,
      };

      const original = executeInstalledHostWriteback(
        { command: "turn-end", homeRoot, host: "claude", payload },
        dependencies,
      );
      await firstRememberStarted;

      await writeFile(
        transcriptPath,
        transcriptUserLine("Next step is the later candidate that can commit.") + "\n",
        { flag: "a" },
      );
      const overlapping = await executeInstalledHostWriteback(
        { command: "turn-end", homeRoot, host: "claude", payload },
        dependencies,
      );
      expect(overlapping.trace.transcriptCursorAdvanced).toBe(false);

      releaseFirstRemember?.();
      expect((await original).reason).toBe("write_failed");

      const retried = await executeInstalledHostWriteback(
        { command: "turn-end", homeRoot, host: "claude", payload },
        dependencies,
      );
      expect(retried.trace.transcriptCursorAdvanced).toBe(true);
      expect(
        rememberCalls.filter((call) => call.messages[0]?.content === firstContent),
      ).toHaveLength(2);

      const consumed = await executeInstalledHostWriteback(
        { command: "turn-end", homeRoot, host: "claude", payload },
        dependencies,
      );
      expect(consumed.trace.transcriptDeltaMessageCount).toBe(0);
    } finally {
      releaseFirstRemember?.();
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not reuse a session cursor across different transcript files", async () => {
    const homeRoot = await createWorkspace(
      "goodmemory-hydration-transcript-identity-home-",
    );
    const workspaceRoot = await createWorkspace(
      "goodmemory-hydration-transcript-identity-workspace-",
    );
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];
    const dependencies = { createMemory: createHydrationMemory({ rememberCalls }) };

    try {
      await writeClaudeHostConfig({ homeRoot, mode: "selective" });
      const firstPath = join(homeRoot, "first-session.jsonl");
      const replacementPath = join(homeRoot, "replacement-session.jsonl");
      const replacementContent =
        `Next step is to read the replacement transcript from byte zero. ${
          "context ".repeat(80)
        }`;
      await writeFile(
        firstPath,
        transcriptUserLine("Next step is the original transcript.") + "\n",
        "utf8",
      );
      await writeFile(
        replacementPath,
        transcriptUserLine(replacementContent) + "\n",
        "utf8",
      );
      const commonPayload = {
        cwd: workspaceRoot,
        session_id: "hydration-reused-session-id",
      };

      await executeInstalledHostWriteback(
        {
          command: "turn-end",
          homeRoot,
          host: "claude",
          payload: { ...commonPayload, transcript_path: firstPath },
        },
        dependencies,
      );
      const replacement = await executeInstalledHostWriteback(
        {
          command: "turn-end",
          homeRoot,
          host: "claude",
          payload: { ...commonPayload, transcript_path: replacementPath },
        },
        dependencies,
      );

      expect(replacement.trace.transcriptCursorAdvanced).toBe(true);
      expect(rememberCalls).toHaveLength(2);
      expect(rememberCalls[1]?.messages[0]?.content).toBe(
        replacementContent.trim(),
      );
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not advance the cursor on write failure so the delta is retried", async () => {
    const homeRoot = await createWorkspace("goodmemory-hydration-retry-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-hydration-retry-workspace-",
    );
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];

    try {
      await writeClaudeHostConfig({ homeRoot, mode: "selective" });
      const transcriptPath = join(homeRoot, "session.jsonl");
      await writeFile(
        transcriptPath,
        transcriptUserLine("Next step is to survive a transient write failure.") +
          "\n",
        "utf8",
      );
      const payload = {
        cwd: workspaceRoot,
        session_id: "hydration-session",
        transcript_path: transcriptPath,
      };

      const failing = await executeInstalledHostWriteback(
        { command: "turn-end", homeRoot, host: "claude", payload },
        {
          createMemory: createHydrationMemory({
            onRemember: () => {
              throw new Error("transient failure");
            },
            rememberCalls,
          }),
        },
      );
      expect(failing.reason).toBe("write_failed");

      const retried = await executeInstalledHostWriteback(
        { command: "turn-end", homeRoot, host: "claude", payload },
        { createMemory: createHydrationMemory({ rememberCalls }) },
      );
      expect(retried.reason).toBe("written");
      expect(
        rememberCalls.at(-1)?.messages?.[0]?.content,
      ).toBe("Next step is to survive a transient write failure.");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("retries the same transcript delta when assisted extraction fails", async () => {
    const homeRoot = await createWorkspace("goodmemory-hydration-extract-retry-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-hydration-extract-retry-workspace-",
    );
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];
    let extractionCalls = 0;

    try {
      await writeClaudeHostConfig({
        assistedExtractor: true,
        homeRoot,
        mode: "selective",
      });
      const transcriptPath = join(homeRoot, "session.jsonl");
      await writeFile(
        transcriptPath,
        transcriptUserLine(
          "Next step is to preserve the retry. The staging database is postgres 16.",
        ) + "\n",
        "utf8",
      );
      const payload = {
        cwd: workspaceRoot,
        session_id: "hydration-session",
        transcript_path: transcriptPath,
      };
      const dependencies = {
        createMemory: createHydrationMemory({ rememberCalls }),
        createWritebackExtractor: () => ({
          async extract() {
            extractionCalls += 1;
            if (extractionCalls === 1) {
              throw new Error("provider unavailable");
            }
            return {
              candidates: [{
                content: "The staging database is postgres 16.",
                explicitness: "explicit" as const,
                id: "assisted-only",
                kindHint: "fact" as const,
                sourceMessageIndex: 0,
                sourceRole: "user" as const,
              }],
              ignoredMessageCount: 0,
            };
          },
        }),
      };

      const failedExtraction = await executeInstalledHostWriteback(
        { command: "turn-end", homeRoot, host: "claude", payload },
        dependencies,
      );
      expect(failedExtraction).toMatchObject({
        reason: "written",
        trace: {
          batchExtraction: "extractor_failed",
          extractionOutcome: "failed",
          transcriptCursorAdvanced: false,
        },
      });

      const retried = await executeInstalledHostWriteback(
        { command: "turn-end", homeRoot, host: "claude", payload },
        dependencies,
      );
      expect(retried).toMatchObject({
        reason: "written",
        trace: {
          batchExtraction: "ok",
          extractionOutcome: "committed",
          transcriptCursorAdvanced: true,
        },
      });
      expect(extractionCalls).toBe(2);
      expect(
        rememberCalls.map((call) => call.messages[0]?.content),
      ).toContain("The staging database is postgres 16.");

      const consumed = await executeInstalledHostWriteback(
        { command: "turn-end", homeRoot, host: "claude", payload },
        dependencies,
      );
      expect(consumed.reason).toBe("empty_transcript");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("keeps hydrated assistant content governed by the assistant policy", async () => {
    const homeRoot = await createWorkspace("goodmemory-hydration-assistant-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-hydration-assistant-workspace-",
    );
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];

    try {
      await writeClaudeHostConfig({ homeRoot, mode: "selective" });
      const transcriptPath = join(homeRoot, "session.jsonl");
      await writeFile(
        transcriptPath,
        transcriptAssistantLine(
          "We decided the canonical source of truth is the writeback ledger.",
        ) + "\n",
        "utf8",
      );

      const result = await executeInstalledHostWriteback(
        {
          command: "turn-end",
          homeRoot,
          host: "claude",
          payload: {
            cwd: workspaceRoot,
            session_id: "hydration-session",
            transcript_path: transcriptPath,
          },
        },
        { createMemory: createHydrationMemory({ rememberCalls }) },
      );

      expect(rememberCalls).toHaveLength(0);
      expect(result.wrote).toBe(false);
      expect(result.candidates).toEqual([
        expect.objectContaining({
          durable: false,
          reason: "assistant_policy_blocked",
          source: "assistant",
        }),
      ]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("redacts secret-like hydrated content before it reaches candidates", async () => {
    const homeRoot = await createWorkspace("goodmemory-hydration-secret-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-hydration-secret-workspace-",
    );
    const rememberCalls: Array<Parameters<GoodMemory["remember"]>[0]> = [];

    try {
      await writeClaudeHostConfig({ homeRoot, mode: "selective" });
      const transcriptPath = join(homeRoot, "session.jsonl");
      await writeFile(
        transcriptPath,
        transcriptUserLine(
          "Remember to use api_key: sk-abcdefghijklmnopqrstuvwx for the bridge.",
        ) + "\n",
        "utf8",
      );

      const result = await executeInstalledHostWriteback(
        {
          command: "turn-end",
          homeRoot,
          host: "claude",
          payload: {
            cwd: workspaceRoot,
            session_id: "hydration-session",
            transcript_path: transcriptPath,
          },
        },
        { createMemory: createHydrationMemory({ rememberCalls }) },
      );

      expect(rememberCalls).toHaveLength(0);
      expect(result.wrote).toBe(false);
      expect(result.candidates).toEqual([
        expect.objectContaining({
          confidence: 0,
          content: "[redacted secret-like content]",
          durable: false,
        }),
      ]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

describe("recordRememberToolWriteback", () => {
  const scope = {
    agentId: "claude",
    userId: "tool-user",
    workspaceId: "workspace-a",
  };

  it("records a committed remember-tool audit event and returns its event id", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "goodmemory-remember-tool-"));
    try {
      const recorded = await recordRememberToolWriteback({
        content: "The staging endpoint is db.internal.example.com.",
        events: [
          {
            candidateId: "candidate-1",
            evidenceIds: ["ev-1"],
            memoryId: "mem-1",
            memoryType: "fact",
            outcome: "written",
          },
        ],
        homeRoot,
        host: "claude",
        mode: "off",
        scope,
        sessionId: "session-9",
        source: "assistant",
      });

      expect(recorded?.eventId).toMatch(/^wb_/);
      const ledger = await readInstalledHostWritebackLedger("claude", homeRoot);
      expect(ledger.auditEvents).toEqual([
        expect.objectContaining({
          command: "remember-tool",
          kind: "fact",
          linkedRecordIds: [
            { id: "mem-1", type: "memory" },
            { id: "ev-1", type: "evidence" },
          ],
          memoryIds: ["mem-1"],
          mode: "off",
          reason: "remember_tool",
          source: "assistant",
          status: "committed",
        }),
      ]);
      expect(ledger.auditEvents[0]?.eventId).toBe(recorded?.eventId ?? "");
      expect(ledger.auditEvents[0]?.sessionDigest).toMatch(/^session:/);
      // Assistant-originated previews stay redacted (the write tool defaults to
      // role=assistant); the content remains recoverable via linkedRecordIds.
      expect(ledger.auditEvents[0]?.contentPreview).toBe(
        "[redacted assistant-originated candidate]",
      );
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("shows the content preview when the tool write is user-originated", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "goodmemory-remember-tool-user-"));
    try {
      await recordRememberToolWriteback({
        content: "The staging endpoint is db.internal.example.com.",
        events: [
          {
            candidateId: "candidate-1",
            memoryId: "mem-1",
            memoryType: "fact",
            outcome: "written",
          },
        ],
        homeRoot,
        host: "claude",
        mode: "selective",
        scope,
        source: "user",
      });

      const ledger = await readInstalledHostWritebackLedger("claude", homeRoot);
      expect(ledger.auditEvents[0]?.contentPreview).toContain("staging endpoint");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("stays idempotent for repeated identical tool writes", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "goodmemory-remember-tool-dup-"));
    try {
      const input = {
        content: "Prefer bun test over npm test in this repo.",
        events: [
          {
            candidateId: "candidate-1",
            memoryId: "mem-1",
            memoryType: "preference" as const,
            outcome: "written" as const,
          },
        ],
        homeRoot,
        host: "claude" as const,
        mode: "selective" as const,
        scope,
        source: "user" as const,
      };
      const first = await recordRememberToolWriteback(input);
      const second = await recordRememberToolWriteback(input);

      expect(second?.eventId).toBe(first?.eventId ?? "");
      const ledger = await readInstalledHostWritebackLedger("claude", homeRoot);
      expect(ledger.auditEvents).toHaveLength(1);
      expect(ledger.auditEvents[0]?.kind).toBe("preference");
      expect(ledger.events).toHaveLength(1);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("records nothing when the write produced no durable records", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "goodmemory-remember-tool-noop-"));
    try {
      const recorded = await recordRememberToolWriteback({
        content: "noise that was rejected",
        events: [
          {
            candidateId: "candidate-1",
            memoryType: "fact",
            outcome: "rejected",
          },
        ],
        homeRoot,
        host: "claude",
        mode: "selective",
        scope,
        source: "assistant",
      });

      expect(recorded).toBeNull();
      const ledger = await readInstalledHostWritebackLedger("claude", homeRoot);
      expect(ledger.auditEvents).toEqual([]);
      expect(ledger.events).toEqual([]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });
});
