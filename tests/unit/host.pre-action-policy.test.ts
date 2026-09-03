import { describe, expect, it } from "bun:test";
import type { ExportMemoryResult, LanguagePack } from "../../src";
import {
  createEnglishLanguagePack,
  createFeedbackMemory,
  createGoodMemory,
  createInMemoryDocumentStore,
  createMemorySource,
  createSessionJournal,
  createWorkingMemorySnapshot,
} from "../../src";
import { createEvidenceRecord } from "../../src/evidence/contracts";
import { attachBehavioralPolicyAttributes } from "../../src/evolution/behavioralPolicy";
import {
  createHostAdapter,
  isHostActionIntent,
  validateHostActionIntent,
} from "../../src/host";
import { buildPageArtifacts } from "../../src/governance/pageArtifacts";

function createExportResult(
  input: Partial<ExportMemoryResult["durable"]> & {
    journal?: NonNullable<ExportMemoryResult["runtime"]>["journal"];
    workingMemory?: NonNullable<ExportMemoryResult["runtime"]>["workingMemory"];
  } = {},
): ExportMemoryResult {
  return {
    pages: buildPageArtifacts({ notes: [] }),
    artifacts: {
      rootPath: ".goodmemory/users/u-1/workspaces/ws-1/sessions/s-1",
      files: [
        {
          kind: "memory",
          relativePath: "MEMORY.md",
          content: "# MEMORY",
        },
      ],
    },
    scope: {
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
    },
    exportedAt: "2026-04-22T00:00:00.000Z",
    durable: {
      profile: null,
      preferences: [],
      references: [],
      facts: [],
      feedback: [],
      episodes: [],
      archives: [],
      evidence: [],
      experiences: [],
      proposals: [],
      promotions: [],
      ...input,
    },
    runtime: {
      workingMemory: input.workingMemory ?? null,
      journal: input.journal ?? null,
      spills: [],
    },
  };
}

async function assessCommandAgainstRule(rule: string, command: string) {
  const source = createMemorySource({
    extractedAt: "2026-04-22T00:00:00.000Z",
    locale: "en-US",
    localeSource: "explicit",
    method: "explicit",
    sessionId: "s-1",
  });
  const adapter = createHostAdapter({
    hostKind: "codex",
    id: "codex-command-rule",
    memory: {
      async exportMemory() {
        return createExportResult({
          feedback: [
            createFeedbackMemory({
              appliesTo: "coding_agent",
              id: "feedback-command-rule",
              kind: "validated_pattern",
              rule,
              sessionId: "s-1",
              source,
              userId: "u-1",
              workspaceId: "ws-1",
            }),
          ],
        });
      },
    },
  });

  return adapter.assessAction({
    action: { command, kind: "command" },
    actionId: "action-command-rule",
    hostKind: "codex",
    occurredAt: "2026-04-22T00:00:00.000Z",
    runId: "run-1",
    scope: {
      sessionId: "s-1",
      userId: "u-1",
      workspaceId: "ws-1",
    },
    sequence: 0,
    turnId: "turn-1",
  });
}

describe("host pre-action policy", () => {
  it("validates host action intents with structured tool payloads", () => {
    const intent = validateHostActionIntent({
      actionId: "action-1",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "codex",
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
        sessionId: "s-1",
      },
      action: {
        kind: "tool_call",
        toolName: "QuickCheck",
        payload: {
          checks: ["network"],
          dryRun: true,
        },
      },
    });

    expect(intent.action.kind).toBe("tool_call");
    if (intent.action.kind !== "tool_call") {
      throw new Error("expected tool_call action");
    }
    expect(intent.action.payload).toEqual({
      checks: ["network"],
      dryRun: true,
    });
    expect(isHostActionIntent(intent)).toBe(true);
    expect(isHostActionIntent({ actionId: "missing-action" })).toBe(false);
  });

  it("rejects file-edit intents whose paths are not normalized relative paths", () => {
    for (const relativePath of [
      "./playbooks/checklist.md",
      "playbooks/./checklist.md",
    ]) {
      expect(() =>
        validateHostActionIntent({
          actionId: "action-file-1",
          runId: "run-1",
          turnId: "turn-1",
          sequence: 0,
          occurredAt: "2026-04-22T00:00:00.000Z",
          hostKind: "codex",
          scope: {
            userId: "u-1",
            workspaceId: "ws-1",
            sessionId: "s-1",
          },
          action: {
            kind: "file_edit",
            operation: "update",
            relativePath,
          },
        })
      ).toThrow(
        "actionIntent.action.relativePath must be a normalized relative path without traversal or absolute segments",
      );
    }
  });

  it("rewrites high-risk deploy actions to review_required when matched memory demands a precondition", async () => {
    const source = createMemorySource({
      method: "explicit",
      extractedAt: "2026-04-22T00:00:00.000Z",
      sessionId: "s-1",
    });
    const adapter = createHostAdapter({
      id: "codex-review",
      hostKind: "codex",
      memory: {
        async exportMemory() {
          return createExportResult({
            feedback: [
              createFeedbackMemory({
                id: "feedback-1",
                userId: "u-1",
                workspaceId: "ws-1",
                sessionId: "s-1",
                kind: "validated_pattern",
                appliesTo: "coding_agent",
                rule: "Before deploy, run smoke verification.",
                evidence: ["evidence-1"],
                source,
              }),
            ],
            evidence: [
              createEvidenceRecord({
                id: "evidence-1",
                userId: "u-1",
                workspaceId: "ws-1",
                sessionId: "s-1",
                kind: "verification_result",
                excerpt: "Production deploy was blocked because smoke verification was skipped.",
                source,
                sourceMessageIds: ["verify-1"],
              }),
            ],
          });
        },
      },
    });

    const result = await adapter.assessAction({
      actionId: "action-deploy-1",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "codex",
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
        sessionId: "s-1",
      },
      action: {
        kind: "command",
        command: "deploy production",
      },
    });

    expect(result.decision).toBe("review_required");
    expect(result.auditRecorded).toBe(false);
    expect(result.matchedMemoryIds).toEqual(["feedback-1"]);
    expect(result.matchedEvidenceIds).toContain("evidence-1");
    expect(result.requiredPreconditions).toEqual([
      "Before deploy, run smoke verification.",
    ]);
    expect(result.recommendedFirstStep).toEqual({
      kind: "warning",
      message: "Before deploy, run smoke verification.",
    });
  });

  it.each([
    {
      expectedPrecondition: "執行 git push 前不要略過驗證。",
      expectedReason: "指令: 執行 git push 前不要略過驗證。",
      id: "traditional-chinese",
      locale: "zh-TW",
      rule: "執行 git push 前不要略過驗證。",
    },
    {
      expectedPrecondition:
        "git push を実行する前に、検証せず実行しないでください。",
      expectedReason:
        "指示: git push を実行する前に、検証せず実行しないでください。",
      id: "japanese",
      locale: "ja-JP",
      rule: "git push を実行する前に、検証せず実行しないでください。",
    },
  ])("applies $id negative pre-action policies with localized preconditions", async ({
    expectedPrecondition,
    expectedReason,
    locale,
    rule,
  }) => {
    const source = createMemorySource({
      extractedAt: "2026-04-22T00:00:00.000Z",
      locale,
      localeSource: "explicit",
      method: "explicit",
      sessionId: "s-1",
    });
    const adapter = createHostAdapter({
      id: `codex-${locale}`,
      hostKind: "codex",
      memory: {
        async exportMemory() {
          return createExportResult({
            feedback: [
              createFeedbackMemory({
                appliesTo: "coding_agent",
                id: `feedback-${locale}`,
                kind: "validated_pattern",
                rule,
                sessionId: "s-1",
                source,
                userId: "u-1",
                workspaceId: "ws-1",
              }),
            ],
          });
        },
      },
    });

    const result = await adapter.assessAction({
      action: {
        command: "git push origin main",
        kind: "command",
      },
      actionId: `action-${locale}`,
      hostKind: "codex",
      occurredAt: "2026-04-22T00:00:00.000Z",
      runId: "run-1",
      scope: {
        sessionId: "s-1",
        userId: "u-1",
        workspaceId: "ws-1",
      },
      sequence: 0,
      turnId: "turn-1",
    });

    expect(result.decision).toBe("review_required");
    expect(result.matchedMemoryIds).toEqual([`feedback-${locale}`]);
    expect(result.requiredPreconditions).toEqual([expectedPrecondition]);
    expect(result.reason).toBe(expectedReason);
    expect(result.recommendedFirstStep).toEqual({
      kind: "warning",
      message: expectedPrecondition,
    });
  });

  it("does not match an unrelated localized policy to a high-risk command", async () => {
    const source = createMemorySource({
      extractedAt: "2026-04-22T00:00:00.000Z",
      locale: "zh-TW",
      localeSource: "explicit",
      method: "explicit",
      sessionId: "s-1",
    });
    const adapter = createHostAdapter({
      id: "codex-unrelated-hant",
      hostKind: "codex",
      memory: {
        async exportMemory() {
          return createExportResult({
            feedback: [
              createFeedbackMemory({
                appliesTo: "coding_agent",
                id: "feedback-unrelated-hant",
                kind: "validated_pattern",
                rule: "執行 npm publish 前不要略過驗證。",
                sessionId: "s-1",
                source,
                userId: "u-1",
                workspaceId: "ws-1",
              }),
            ],
          });
        },
      },
    });

    const result = await adapter.assessAction({
      action: {
        command: "git push origin main",
        kind: "command",
      },
      actionId: "action-unrelated-hant",
      hostKind: "codex",
      occurredAt: "2026-04-22T00:00:00.000Z",
      runId: "run-1",
      scope: {
        sessionId: "s-1",
        userId: "u-1",
        workspaceId: "ws-1",
      },
      sequence: 0,
      turnId: "turn-1",
    });

    expect(result.decision).toBe("allow");
    expect(result.matchedMemoryIds).toEqual([]);
    expect(result.requiredPreconditions).toEqual([]);
  });

  it("does not match an unrelated English policy when only before overlaps", async () => {
    const source = createMemorySource({
      extractedAt: "2026-04-22T00:00:00.000Z",
      locale: "en-US",
      localeSource: "explicit",
      method: "explicit",
      sessionId: "s-1",
    });
    const adapter = createHostAdapter({
      id: "codex-unrelated-english-before",
      hostKind: "codex",
      memory: {
        async exportMemory() {
          return createExportResult({
            feedback: [
              createFeedbackMemory({
                appliesTo: "coding_agent",
                id: "feedback-unrelated-english-before",
                kind: "validated_pattern",
                rule: "Before publishing docs, run smoke verification.",
                sessionId: "s-1",
                source,
                userId: "u-1",
                workspaceId: "ws-1",
              }),
            ],
          });
        },
      },
    });

    const result = await adapter.assessAction({
      action: {
        command: "deploy production",
        kind: "command",
        summary: "Before deleting the old release, prepare the deployment.",
      },
      actionId: "action-unrelated-english-before",
      hostKind: "codex",
      occurredAt: "2026-04-22T00:00:00.000Z",
      runId: "run-1",
      scope: {
        sessionId: "s-1",
        userId: "u-1",
        workspaceId: "ws-1",
      },
      sequence: 0,
      turnId: "turn-1",
    });

    expect(result.decision).toBe("allow");
    expect(result.matchedMemoryIds).toEqual([]);
    expect(result.requiredPreconditions).toEqual([]);
  });

  it.each([
    { command: "npm publish", tool: "npm" },
    { command: "bun run release", tool: "bun" },
  ])("keeps the three-character $tool token in English policy matching", async ({
    command,
    tool,
  }) => {
    const source = createMemorySource({
      extractedAt: "2026-04-22T00:00:00.000Z",
      locale: "en-US",
      localeSource: "explicit",
      method: "explicit",
      sessionId: "s-1",
    });
    const memoryId = `feedback-never-use-${tool}`;
    const adapter = createHostAdapter({
      id: `codex-never-use-${tool}`,
      hostKind: "codex",
      memory: {
        async exportMemory() {
          return createExportResult({
            feedback: [
              createFeedbackMemory({
                appliesTo: "coding_agent",
                id: memoryId,
                kind: "validated_pattern",
                rule: `Never use ${tool}.`,
                sessionId: "s-1",
                source,
                userId: "u-1",
                workspaceId: "ws-1",
              }),
            ],
          });
        },
      },
    });

    const result = await adapter.assessAction({
      action: { command, kind: "command" },
      actionId: `action-never-use-${tool}`,
      hostKind: "codex",
      occurredAt: "2026-04-22T00:00:00.000Z",
      runId: "run-1",
      scope: {
        sessionId: "s-1",
        userId: "u-1",
        workspaceId: "ws-1",
      },
      sequence: 0,
      turnId: "turn-1",
    });

    expect(result.decision).toBe("review_required");
    expect(result.matchedMemoryIds).toEqual([memoryId]);
  });

  it("does not apply a negative executable clause to the allowed replacement", async () => {
    const result = await assessCommandAgainstRule(
      "Never use npm; use bun instead.",
      "bun run release",
    );

    expect(result.decision).toBe("allow");
    expect(result.matchedMemoryIds).toEqual([]);
  });

  it("keeps English conjunction boundaries owned by the language pack", async () => {
    const result = await assessCommandAgainstRule(
      "Never use npm, but use bun instead.",
      "bun run release",
    );

    expect(result.decision).toBe("allow");
    expect(result.matchedMemoryIds).toEqual([]);
  });

  it("finds the executable after environment assignments and wrappers", async () => {
    const result = await assessCommandAgainstRule(
      "Never use npm.",
      "env NODE_ENV=production npm publish",
    );

    expect(result.decision).toBe("review_required");
    expect(result.matchedMemoryIds).toEqual(["feedback-command-rule"]);
  });

  it("reuses the custom language service owned by the GoodMemory instance", async () => {
    const documentStore = createInMemoryDocumentStore();
    const english = createEnglishLanguagePack();
    let splitClausesCalls = 0;
    const customPack = {
      ...english,
      analyzerVersion: "host-policy-custom-v1",
      analyzeContent(text) {
        return {
          ...english.analyzeContent(text),
          feedbackKind: text.includes("sentinel-policy") ? "dont" : "do",
        };
      },
      render(input) {
        return input.key === "instruction"
          ? "sentinel-instruction"
          : english.render(input);
      },
      splitClauses(text) {
        splitClausesCalls += 1;
        return english.splitClauses(text);
      },
      tokenizeForScoring(text, mode, options) {
        if (/sentinel-policy|opaque-action/u.test(text)) {
          return ["custom-shared-token"];
        }
        return english.tokenizeForScoring(text, mode, options);
      },
    } satisfies LanguagePack;
    const memory = createGoodMemory({
      adapters: { documentStore },
      language: { packs: [customPack] },
      storage: { provider: "memory" },
    });
    const source = createMemorySource({
      extractedAt: "2026-04-22T00:00:00.000Z",
      locale: "en",
      localeSource: "explicit",
      method: "explicit",
      sessionId: "s-1",
    });
    await documentStore.set(
      "feedback",
      "feedback-custom-language",
      createFeedbackMemory({
        appliesTo: "coding_agent",
        id: "feedback-custom-language",
        kind: "validated_pattern",
        rule: "sentinel-policy",
        sessionId: "s-1",
        source,
        userId: "u-1",
        workspaceId: "ws-1",
      }),
    );
    const adapter = createHostAdapter({
      id: "codex-custom-language",
      hostKind: "codex",
      memory,
    });

    const result = await adapter.assessAction({
      action: {
        command: "deploy opaque-action",
        kind: "command",
      },
      actionId: "action-custom-language",
      hostKind: "codex",
      occurredAt: "2026-04-22T00:00:00.000Z",
      runId: "run-1",
      scope: {
        sessionId: "s-1",
        userId: "u-1",
        workspaceId: "ws-1",
      },
      sequence: 0,
      turnId: "turn-1",
    });

    expect(result.decision).toBe("review_required");
    expect(result.matchedMemoryIds).toEqual(["feedback-custom-language"]);
    expect(result.reason).toBe("sentinel-instruction: sentinel-policy");
    expect(result.recommendedFirstStep).toEqual({
      kind: "warning",
      message: "sentinel-policy",
    });
    expect(splitClausesCalls).toBeGreaterThan(0);
  });

  it("rewrites to an executable QuickCheck path when the original command resolves a sibling executable", async () => {
    const source = createMemorySource({
      method: "explicit",
      extractedAt: "2026-04-22T00:00:00.000Z",
      sessionId: "s-1",
    });
    const adapter = createHostAdapter({
      id: "codex-deepanalyzer",
      hostKind: "codex",
      memory: {
        async exportMemory() {
          return createExportResult({
            feedback: [
              createFeedbackMemory({
                id: "feedback-deepanalyzer-1",
                userId: "u-1",
                workspaceId: "ws-1",
                sessionId: "s-1",
                kind: "validated_pattern",
                appliesTo: "coding_agent",
                rule: "Rather than DeepAnalyzer, use QuickCheck first.",
                evidence: ["evidence-deepanalyzer-1"],
                source,
              }),
            ],
            evidence: [
              createEvidenceRecord({
                id: "evidence-deepanalyzer-1",
                userId: "u-1",
                workspaceId: "ws-1",
                sessionId: "s-1",
                kind: "correction_context",
                excerpt: "DeepAnalyzer detailed scan failed because QuickCheck had not run first.",
                source,
                sourceMessageIds: ["deepanalyzer-1"],
              }),
            ],
          });
        },
      },
    });

    const result = await adapter.assessAction({
      actionId: "action-deepanalyzer-1",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "codex",
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
        sessionId: "s-1",
      },
      action: {
        kind: "command",
        command: "./tools/DeepAnalyzer --detailed",
      },
    });

    expect(result.decision).toBe("review_required");
    expect(result.requiredPreconditions).toEqual([
      "Rather than DeepAnalyzer, use QuickCheck first.",
    ]);
    expect(result.recommendedFirstStep).toEqual({
      kind: "tool_call",
      toolName: "QuickCheck",
      raw: "./tools/QuickCheck",
      summary:
        "Instruction: Rather than DeepAnalyzer, use QuickCheck first.",
    });
  });

  it("fails closed to a warning when QuickCheck is only referenced by bare command name", async () => {
    const source = createMemorySource({
      method: "explicit",
      extractedAt: "2026-04-22T00:00:00.000Z",
      sessionId: "s-1",
    });
    const adapter = createHostAdapter({
      id: "codex-deepanalyzer-bare",
      hostKind: "codex",
      memory: {
        async exportMemory() {
          return createExportResult({
            feedback: [
              createFeedbackMemory({
                id: "feedback-deepanalyzer-bare-1",
                userId: "u-1",
                workspaceId: "ws-1",
                sessionId: "s-1",
                kind: "validated_pattern",
                appliesTo: "coding_agent",
                rule: "Rather than DeepAnalyzer, use QuickCheck first.",
                evidence: ["evidence-deepanalyzer-bare-1"],
                source,
              }),
            ],
            evidence: [
              createEvidenceRecord({
                id: "evidence-deepanalyzer-bare-1",
                userId: "u-1",
                workspaceId: "ws-1",
                sessionId: "s-1",
                kind: "correction_context",
                excerpt: "DeepAnalyzer detailed scan failed because QuickCheck had not run first.",
                source,
                sourceMessageIds: ["deepanalyzer-bare-1"],
              }),
            ],
          });
        },
      },
    });

    const result = await adapter.assessAction({
      actionId: "action-deepanalyzer-bare-1",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "codex",
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
        sessionId: "s-1",
      },
      action: {
        kind: "command",
        command: "DeepAnalyzer --detailed",
      },
    });

    expect(result.decision).toBe("review_required");
    expect(result.requiredPreconditions).toEqual([
      "Rather than DeepAnalyzer, use QuickCheck first.",
    ]);
    expect(result.recommendedFirstStep).toEqual({
      kind: "warning",
      message: "Rather than DeepAnalyzer, use QuickCheck first.",
    });
  });

  it("enforces QuickCheck-first policies through every built-in language", async () => {
    const cases = [
      {
        instruction: "Instruction",
        locale: "en-US",
        rule: "For DeepAnalyzer, run QuickCheck first.",
      },
      {
        instruction: "指令",
        locale: "zh-CN",
        rule: "使用 DeepAnalyzer 深入分析时，请先运行 QuickCheck。",
      },
      {
        instruction: "指令",
        locale: "zh-TW",
        rule: "使用 DeepAnalyzer 深入分析時，請先執行 QuickCheck。",
      },
      {
        instruction: "指示",
        locale: "ja-JP",
        rule: "DeepAnalyzer の詳細分析では、まず QuickCheck を実行してください。",
      },
      {
        instruction: "명령",
        locale: "ko-KR",
        rule: "DeepAnalyzer 심층 분석에서는 QuickCheck를 먼저 실행하세요.",
      },
      {
        instruction: "Instruction",
        locale: "fr-FR",
        rule: "Pour DeepAnalyzer, exécutez d’abord QuickCheck.",
      },
      {
        instruction: "Instrucción",
        locale: "es-ES",
        rule: "Para DeepAnalyzer, ejecuta primero QuickCheck.",
      },
    ] as const;

    for (const { instruction, locale, rule } of cases) {
      const source = createMemorySource({
        extractedAt: "2026-04-22T00:00:00.000Z",
        locale,
        localeSource: "explicit",
        method: "explicit",
        sessionId: "s-1",
      });
      const adapter = createHostAdapter({
        hostKind: "codex",
        id: `codex-${locale}`,
        memory: {
          async exportMemory() {
            return createExportResult({
              feedback: [
                createFeedbackMemory({
                  appliesTo: "coding_agent",
                  id: `feedback-${locale}`,
                  kind: "validated_pattern",
                  rule,
                  sessionId: "s-1",
                  source,
                  userId: "u-1",
                  workspaceId: "ws-1",
                }),
              ],
            });
          },
        },
      });

      const result = await adapter.assessAction({
        action: {
          command: "./tools/DeepAnalyzer --detailed",
          kind: "command",
        },
        actionId: `action-${locale}`,
        hostKind: "codex",
        occurredAt: "2026-04-22T00:00:00.000Z",
        runId: "run-1",
        scope: {
          sessionId: "s-1",
          userId: "u-1",
          workspaceId: "ws-1",
        },
        sequence: 0,
        turnId: "turn-1",
      });

      expect(result.decision, locale).toBe("review_required");
      expect(result.requiredPreconditions, locale).toEqual([rule]);
      expect(result.reason, locale).toBe(`${instruction}: ${rule}`);
      expect(result.recommendedFirstStep, locale).toEqual({
        kind: "tool_call",
        raw: "./tools/QuickCheck",
        summary: `${instruction}: ${rule}`,
        toolName: "QuickCheck",
      });
    }
  });

  it("prioritizes typed first-action policy over generic host guidance and preserves exact first action", async () => {
    const source = createMemorySource({
      method: "confirmed",
      extractedAt: "2026-04-30T00:00:00.000Z",
      sessionId: "s-1",
    });
    const adapter = createHostAdapter({
      id: "codex-typed-first-action",
      hostKind: "codex",
      memory: {
        async exportMemory() {
          return createExportResult({
            feedback: [
              createFeedbackMemory({
                id: "feedback-typed-1",
                userId: "u-1",
                workspaceId: "ws-1",
                sessionId: "s-1",
                kind: "validated_pattern",
                appliesTo: "coding_agent",
                rule:
                  "If the prompt mentions detailed analysis, use QuickCheck --network before DeepAnalyzer.",
                attributes: attachBehavioralPolicyAttributes(undefined, {
                  behavioralKind: "first_action",
                  enactmentSurface: "host_action",
                  applicability: {
                    actionSummaryContains: ["detailed analysis"],
                    appliesTo: "coding_agent",
                    canonicalFirstAction: {
                      kind: "tool_call",
                      name: "QuickCheck",
                      raw: "QuickCheck --network",
                    },
                    queryContains: ["detailed analysis"],
                  },
                  transferMode: "pattern_bounded",
                }),
                evidence: ["evidence-typed-1"],
                source,
              }),
            ],
            evidence: [
              createEvidenceRecord({
                id: "evidence-typed-1",
                userId: "u-1",
                workspaceId: "ws-1",
                sessionId: "s-1",
                kind: "correction_context",
                excerpt:
                  "Detailed analysis should start with QuickCheck --network before any deeper inspection.",
                source,
                sourceMessageIds: ["typed-1"],
              }),
            ],
          });
        },
      },
    });

    const result = await adapter.assessAction({
      actionId: "action-typed-1",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-30T00:00:00.000Z",
      hostKind: "codex",
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
        sessionId: "s-1",
      },
      action: {
        kind: "tool_call",
        toolName: "DeepAnalyzer",
        raw: "DeepAnalyzer --detailed",
        summary: "Run detailed analysis on the network path.",
      },
    });

    expect(result.decision).toBe("review_required");
    expect(result.matchedMemoryIds).toContain("feedback-typed-1");
    expect(result.recommendedFirstStep).toEqual({
      kind: "tool_call",
      raw: "QuickCheck --network",
      summary:
        "Instruction: If the prompt mentions detailed analysis, use QuickCheck --network before DeepAnalyzer.",
      toolName: "QuickCheck",
    });
  });

  it("does not block a typed canonical first action when the host action only adds dynamic instance args", async () => {
    const source = createMemorySource({
      method: "confirmed",
      extractedAt: "2026-04-30T00:00:00.000Z",
      sessionId: "s-1",
    });
    const adapter = createHostAdapter({
      id: "codex-typed-first-action-satisfied",
      hostKind: "codex",
      memory: {
        async exportMemory() {
          return createExportResult({
            feedback: [
              createFeedbackMemory({
                id: "feedback-typed-satisfied-1",
                userId: "u-1",
                workspaceId: "ws-1",
                sessionId: "s-1",
                kind: "validated_pattern",
                appliesTo: "coding_agent",
                rule:
                  "If the prompt mentions detailed analysis, use QuickCheck --network before DeepAnalyzer.",
                attributes: attachBehavioralPolicyAttributes(undefined, {
                  behavioralKind: "first_action",
                  enactmentSurface: "host_action",
                  applicability: {
                    actionSummaryContains: ["detailed analysis"],
                    appliesTo: "coding_agent",
                    canonicalFirstAction: {
                      args: ["--network"],
                      kind: "tool_call",
                      name: "QuickCheck",
                      raw: "QuickCheck --network",
                    },
                    queryContains: ["detailed analysis"],
                  },
                  transferMode: "pattern_bounded",
                }),
                evidence: ["evidence-typed-satisfied-1"],
                source,
              }),
            ],
            evidence: [
              createEvidenceRecord({
                id: "evidence-typed-satisfied-1",
                userId: "u-1",
                workspaceId: "ws-1",
                sessionId: "s-1",
                kind: "correction_context",
                excerpt:
                  "Detailed analysis should start with QuickCheck --network before any deeper inspection.",
                source,
                sourceMessageIds: ["typed-satisfied-1"],
              }),
            ],
          });
        },
      },
    });

    const result = await adapter.assessAction({
      actionId: "action-typed-satisfied-1",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-30T00:00:00.000Z",
      hostKind: "codex",
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
        sessionId: "s-1",
      },
      action: {
        kind: "tool_call",
        toolName: "QuickCheck",
        raw: "QuickCheck --network /tmp/worktree-a",
        summary: "Run detailed analysis on the network path.",
      },
    });

    expect(result.decision).toBe("allow_with_guidance");
    expect(result.matchedMemoryIds).toContain("feedback-typed-satisfied-1");
    expect(result.recommendedFirstStep).toBeUndefined();
  });

  it("blocks destructive file deletes when a matched validated pattern vetoes the action", async () => {
    const source = createMemorySource({
      method: "explicit",
      extractedAt: "2026-04-22T00:00:00.000Z",
      sessionId: "s-1",
    });
    const adapter = createHostAdapter({
      id: "codex-block",
      hostKind: "codex",
      memory: {
        async exportMemory() {
          return createExportResult({
            feedback: [
              createFeedbackMemory({
                id: "feedback-delete-1",
                userId: "u-1",
                workspaceId: "ws-1",
                sessionId: "s-1",
                kind: "validated_pattern",
                appliesTo: "coding_agent",
                rule: "Never delete AGENTS.md from the host bootstrap surface.",
                why: "It breaks repo-local host wiring and package bootstrap continuity.",
                evidence: ["evidence-delete-1"],
                source,
              }),
            ],
            evidence: [
              createEvidenceRecord({
                id: "evidence-delete-1",
                userId: "u-1",
                workspaceId: "ws-1",
                sessionId: "s-1",
                kind: "correction_context",
                excerpt: "Deleting AGENTS.md removed the Codex bootstrap instructions.",
                source,
                sourceMessageIds: ["correction-1"],
              }),
            ],
          });
        },
      },
    });

    const result = await adapter.assessAction({
      actionId: "action-delete-1",
      attemptId: "attempt-1",
      turnId: "turn-2",
      sequence: 1,
      occurredAt: "2026-04-22T00:00:01.000Z",
      hostKind: "codex",
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
        sessionId: "s-1",
      },
      action: {
        kind: "file_edit",
        operation: "delete",
        relativePath: "AGENTS.md",
      },
    });

    expect(result.decision).toBe("blocked");
    expect(result.matchedMemoryIds).toEqual(["feedback-delete-1"]);
    expect(result.recommendedFirstStep).toBeUndefined();
  });

  it("keeps runtime continuity guidance non-blocking when no memory-backed veto is matched", async () => {
    const adapter = createHostAdapter({
      id: "codex-guidance",
      hostKind: "codex",
      memory: {
        async exportMemory() {
          return createExportResult({
            workingMemory: createWorkingMemorySnapshot({
              sessionId: "s-1",
              userId: "u-1",
              currentGoal: "Close the external host rollout",
              openLoops: ["archive the canonical Codex evidence chain"],
              temporaryDecisions: ["Use the current runbook before deploy."],
              updatedAt: "2026-04-22T00:00:00.000Z",
            }),
            journal: createSessionJournal({
              sessionId: "s-1",
              userId: "u-1",
              workflow: ["Review the exported session handoff"],
              updatedAt: "2026-04-22T00:00:00.000Z",
            }),
          });
        },
      },
    });

    const result = await adapter.assessAction({
      actionId: "action-guidance-1",
      runId: "run-1",
      turnId: "turn-3",
      sequence: 2,
      occurredAt: "2026-04-22T00:00:02.000Z",
      hostKind: "codex",
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
        sessionId: "s-1",
      },
      action: {
        kind: "command",
        command: "deploy preview",
      },
    });

    expect(result.decision).toBe("allow_with_guidance");
    expect(result.matchedMemoryIds).toEqual([]);
    expect(result.guidance).toContain("Use the current runbook before deploy.");
    expect(result.guidance.some((line) => line.includes("Review the exported session handoff"))).toBe(
      true,
    );
  });

  it("rejects assessments whose declared host kind does not match the adapter host kind", async () => {
    const adapter = createHostAdapter({
      id: "codex-review",
      hostKind: "codex",
      memory: {
        async exportMemory() {
          return createExportResult();
        },
      },
    });

    await expect(
      adapter.assessAction({
        actionId: "action-mismatch-1",
        runId: "run-1",
        turnId: "turn-1",
        sequence: 0,
        occurredAt: "2026-04-22T00:00:00.000Z",
        hostKind: "claude",
        scope: {
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
        },
        action: {
          kind: "command",
          command: "deploy production",
        },
      })
    ).rejects.toThrow(
      "host action intent hostKind claude does not match adapter hostKind codex",
    );
  });
});
