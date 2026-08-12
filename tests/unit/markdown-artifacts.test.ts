import { describe, expect, it } from "bun:test";
import type { ArtifactSpillRecord } from "../../src/domain/records";
import {
  createFactMemory,
  createFeedbackMemory,
  createPreferenceMemory,
  createReferenceMemory,
  createSessionJournal,
  createUserProfile,
  createWorkingMemorySnapshot,
} from "../../src/domain/records";
import { createMemorySource } from "../../src/domain/provenance";
import { createEvidenceRecord } from "../../src/evidence/contracts";
import {
  createExperienceRecord,
  createLearningProposal,
  createPromotionRecord,
  createSessionArchive,
} from "../../src/evolution/contracts";
import { buildMarkdownArtifacts } from "../../src/governance/markdownArtifacts";
import { createLanguageService } from "../../src/language";

function buildProjectionInput() {
  const language = createLanguageService();
  const source = createMemorySource({
    method: "explicit",
    extractedAt: "2026-04-02T00:00:00.000Z",
    sessionId: "s-1",
  });
  const spill: ArtifactSpillRecord = {
    id: "spill-1",
    scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
    kind: "tool_result",
    sourceId: "tool-1",
    preview: "Large tool payload preview",
    replacementText: "[spill-1]",
    storageUri: "memory://spill-1",
    originalBytes: 128,
    createdAt: "2026-04-02T00:00:00.000Z",
  };

  return {
    language,
    languageContext: language.resolveFromText({
      locale: "en-US",
      text: "Export memory artifacts.",
    }),
    scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" } as const,
    durable: {
      profile: createUserProfile({
        userId: "u-1",
        identity: {
          name: "Lin",
          role: "Robotics engineer",
        },
        activeContext: {
          goals: ["Finish rollout"],
          currentProjects: ["Migration rollout"],
        },
        createdAt: "2026-04-02T00:00:00.000Z",
        updatedAt: "2026-04-02T00:00:00.000Z",
      }),
      preferences: [
        createPreferenceMemory({
          id: "pref-1",
          userId: "u-1",
          workspaceId: "workspace-a",
          sessionId: "s-1",
          category: "response_style",
          value: "bullet points",
          source,
          updatedAt: "2026-04-02T00:00:00.000Z",
        }),
      ],
      references: [
        createReferenceMemory({
          id: "ref-1",
          userId: "u-1",
          workspaceId: "workspace-a",
          sessionId: "s-1",
          title: "Runbook",
          pointer: "docs/runbook.md",
          source,
          updatedAt: "2026-04-02T00:00:00.000Z",
          createdAt: "2026-04-02T00:00:00.000Z",
        }),
      ],
      facts: [
        createFactMemory({
          id: "fact-1",
          userId: "u-1",
          workspaceId: "workspace-a",
          sessionId: "s-1",
          category: "project",
          content: "Migration rollout is blocked on prod verification.",
          source,
          updatedAt: "2026-04-02T00:00:00.000Z",
          createdAt: "2026-04-02T00:00:00.000Z",
        }),
      ],
      feedback: [
        createFeedbackMemory({
          id: "fb-1",
          userId: "u-1",
          workspaceId: "workspace-a",
          sessionId: "s-1",
          rule: "Keep answers concise.",
          kind: "do",
          source,
          updatedAt: "2026-04-02T00:00:00.000Z",
        }),
      ],
      episodes: [],
      archives: [
        createSessionArchive({
          id: "archive-1",
          userId: "u-1",
          workspaceId: "workspace-a",
          sessionId: "s-1",
          summary: "Session paused after rollout verification planning.",
          unresolvedItems: ["verify prod"],
          createdAt: "2026-04-02T00:00:00.000Z",
          archivedAt: "2026-04-02T00:00:00.000Z",
        }),
      ],
      evidence: [
        createEvidenceRecord({
          id: "evidence-1",
          userId: "u-1",
          workspaceId: "workspace-a",
          sessionId: "s-1",
          kind: "conversation_excerpt",
          excerpt: "The user said prod verification is still blocking the rollout.",
          source,
          linkedMemoryIds: ["fact-1"],
        }),
      ],
      experiences: [
        createExperienceRecord({
          id: "experience-1",
          userId: "u-1",
          workspaceId: "workspace-a",
          sessionId: "s-1",
          kind: "session_end",
          traceId: "trace-1",
          summary: "Session ended after rollout planning.",
          createdAt: "2026-04-02T00:00:00.000Z",
        }),
      ],
      proposals: [
        createLearningProposal({
          id: "proposal-1",
          userId: "u-1",
          workspaceId: "workspace-a",
          sessionId: "s-1",
          proposalType: "memory_revision",
          traceId: "trace-proposal-1",
          summary: "Revise the rollout blocker after repeated corrections.",
          rationale: "Later evidence shows the blocker statement is stale.",
          createdAt: "2026-04-02T00:00:00.000Z",
          updatedAt: "2026-04-02T00:00:00.000Z",
        }),
      ],
      promotions: [
        createPromotionRecord({
          id: "promotion-1",
          proposalId: "proposal-1",
          userId: "u-1",
          workspaceId: "workspace-a",
          sessionId: "s-1",
          traceId: "trace-promotion-1",
          decision: "delayed",
          summary: "Delay the rollout revision until verification reruns.",
          rationale: "The proposal should not mutate durable memory before re-check.",
          policyOutcome: "review_required",
          verificationOutcome: "blocked",
          evalOutcome: "not_run",
          createdAt: "2026-04-02T00:00:00.000Z",
          decidedAt: "2026-04-02T00:00:00.000Z",
        }),
      ],
    },
    runtime: {
      workingMemory: createWorkingMemorySnapshot({
        sessionId: "s-1",
        userId: "u-1",
        currentGoal: "Finish rollout",
        openLoops: ["verify prod"],
        updatedAt: "2026-04-02T00:00:00.000Z",
      }),
      journal: createSessionJournal({
        sessionId: "s-1",
        userId: "u-1",
        currentState: "Verification queued",
        worklog: ["Checked rollout status."],
        updatedAt: "2026-04-02T00:00:00.000Z",
      }),
      spills: [spill],
    },
  };
}

describe("markdown artifact projection", () => {
  it("renders Traditional Chinese artifact and playbook labels while preserving machine fields", () => {
    const language = createLanguageService({ defaultLocale: "zh-Hant" });
    const languageContext = language.resolveFromText({
      locale: "zh-Hant",
      text: "請使用繁體中文匯出記憶。",
    });
    const input = buildProjectionInput();
    const source = createMemorySource({
      method: "confirmed",
      extractedAt: "2026-04-02T00:00:00.000Z",
      sessionId: "s-1",
    });
    const artifacts = buildMarkdownArtifacts({
      ...input,
      durable: {
        ...input.durable,
        feedback: [
          ...input.durable.feedback,
          createFeedbackMemory({
            id: "pattern-localized-artifact",
            userId: "u-1",
            workspaceId: "workspace-a",
            sessionId: "s-1",
            rule: "Use bullet points in summaries.",
            kind: "validated_pattern",
            source,
            updatedAt: "2026-04-02T00:00:00.000Z",
          }),
        ],
      },
      language,
      languageContext,
    });
    const user = artifacts.files.find(({ relativePath }) => relativePath === "user.md");
    const memory = artifacts.files.find(({ relativePath }) => relativePath === "MEMORY.md");
    const session = artifacts.files.find(({ relativePath }) => relativePath === "session.md");
    const archive = artifacts.files.find(({ kind }) => kind === "archive");
    const playbook = artifacts.files.find(
      ({ relativePath }) => relativePath === "playbooks/use-bullet-points-in-summaries.md",
    );

    expect(user?.content).toContain("# 使用者記憶");
    expect(user?.content).toContain("## 使用者資料");
    expect(memory?.content).toContain("# 記憶索引");
    expect(memory?.content).toContain("## 參考資料");
    expect(memory?.content).toContain("## 事實");
    expect(memory?.content).toContain("## 工作記憶");
    expect(memory?.content).toContain("## 日誌");
    expect(session?.content).toContain("# 會話記憶：s-1");
    expect(archive?.content).toContain("# 歸檔摘要：s-1");
    expect(playbook?.content).toContain("# 操作手冊：Use bullet points in summaries.");
    expect(playbook?.content).toContain("## 規範模式");
    expect(playbook?.content).toContain("## 原因");
    expect(playbook?.content).toContain("## 沿襲關係");
    expect(playbook?.content).toContain("canonicalMemoryId: pattern-localized-artifact");
  });

  it("localizes playbook, prompt, and skill human-readable headings for every built-in pack", () => {
    const cases = [
      {
        locale: "ja-JP",
        rule: "要約では箇条書きを使ってください。",
        titles: [
          "# プレイブック: 要約では箇条書きを使ってください。",
          "## 正規パターン",
          "## ガイダンス",
          "## 理由",
          "## 系譜",
          "# プロンプトスニペット: 要約では箇条書きを使ってください。",
          "## 使用条件",
          "## 指示",
          "# スキルスニペット: 要約では箇条書きを使ってください。",
          "## メタデータ",
          "## 手順",
        ],
      },
      {
        locale: "ko-KR",
        rule: "요약에는 글머리 기호를 사용하세요.",
        titles: [
          "# 플레이북: 요약에는 글머리 기호를 사용하세요.",
          "## 정규 패턴",
          "## 지침",
          "## 이유",
          "## 계보",
          "# 프롬프트 스니펫: 요약에는 글머리 기호를 사용하세요.",
          "## 사용 시점",
          "## 명령",
          "# 스킬 스니펫: 요약에는 글머리 기호를 사용하세요.",
          "## 메타데이터",
          "## 절차",
        ],
      },
      {
        locale: "fr-FR",
        rule: "Utilisez des listes à puces dans les résumés.",
        titles: [
          "# Guide opérationnel : Utilisez des listes à puces dans les résumés.",
          "## Modèle canonique",
          "## Directive",
          "## Pourquoi",
          "## Lignée",
          "# Extrait d’invite : Utilisez des listes à puces dans les résumés.",
          "## À utiliser quand",
          "## Instruction",
          "# Extrait de compétence : Utilisez des listes à puces dans les résumés.",
          "## Métadonnées",
          "## Procédure",
        ],
      },
      {
        locale: "es-ES",
        rule: "Usa listas con viñetas en los resúmenes.",
        titles: [
          "# Manual: Usa listas con viñetas en los resúmenes.",
          "## Patrón canónico",
          "## Guía",
          "## Motivo",
          "## Linaje",
          "# Fragmento de prompt: Usa listas con viñetas en los resúmenes.",
          "## Cuándo usarlo",
          "## Instrucción",
          "# Fragmento de habilidad: Usa listas con viñetas en los resúmenes.",
          "## Metadatos",
          "## Procedimiento",
        ],
      },
    ] as const;

    for (const entry of cases) {
      const input = buildProjectionInput();
      const language = createLanguageService({ defaultLocale: entry.locale });
      const languageContext = language.resolveFromText({
        locale: entry.locale,
        text: entry.rule,
      });
      const artifacts = buildMarkdownArtifacts({
        ...input,
        durable: {
          ...input.durable,
          feedback: [
            createFeedbackMemory({
              appliesTo: "general_response",
              id: `pattern-${entry.locale}`,
              kind: "validated_pattern",
              rule: entry.rule,
              source: createMemorySource({
                extractedAt: "2026-04-02T00:00:00.000Z",
                method: "confirmed",
              }),
              updatedAt: "2026-04-02T00:00:00.000Z",
              userId: "u-1",
              why: entry.rule,
              workspaceId: "workspace-a",
            }),
          ],
        },
        language,
        languageContext,
      });
      const contents = artifacts.files
        .filter(({ kind }) => kind === "playbook")
        .map(({ content }) => content)
        .join("\n");

      for (const title of entry.titles) {
        expect(contents).toContain(title);
      }
      expect(contents).toContain(`canonicalMemoryId: pattern-${entry.locale}`);
      expect(contents).toContain("appliesTo: general_response");
    }
  });

  it("renders deterministic scope-aware markdown artifacts from canonical memory state", () => {
    const first = buildMarkdownArtifacts(buildProjectionInput());
    const second = buildMarkdownArtifacts(buildProjectionInput());

    expect(first).toEqual(second);
    expect(first.rootPath).toBe(".goodmemory/users/u-1/workspaces/workspace-a/sessions/s-1");
    expect(first.files.map((file) => file.relativePath)).toEqual([
      "user.md",
      "MEMORY.md",
      "session.md",
      "archive/2026/04/s-1.md",
    ]);
    expect(first.files[1]?.content).toContain("# MEMORY");
    expect(first.files[1]?.content).toContain("Migration rollout is blocked on prod verification.");
    expect(first.files[1]?.content).toContain("## Learning Proposals");
    expect(first.files[1]?.content).toContain(
      "Revise the rollout blocker after repeated corrections.",
    );
    expect(first.files[1]?.content).toContain("## Promotions");
    expect(first.files[1]?.content).toContain(
      "Delay the rollout revision until verification reruns.",
    );
    expect(first.files[2]?.content).toContain(
      "Revise the rollout blocker after repeated corrections.",
    );
    expect(first.files[2]?.content).toContain(
      "Delay the rollout revision until verification reruns.",
    );
    expect(first.files[2]?.content).toContain("Current goal: Finish rollout");
    expect(first.files[2]?.content).toContain("Large tool payload preview");
    expect(first.files[3]?.content).toContain("# Archive Recap: s-1");
    expect(first.files[3]?.content).toContain(
      "Session paused after rollout verification planning.",
    );
  });

  it("exports absolute event occurrence in markdown artifacts", () => {
    const input = buildProjectionInput();
    const artifacts = buildMarkdownArtifacts({
      ...input,
      durable: {
        ...input.durable,
        facts: input.durable.facts.map((fact) => createFactMemory({
          ...fact,
          occurrence: {
            start: "2026-04-01T16:00:00.000Z",
            endExclusive: "2026-04-02T16:00:00.000Z",
            precision: "day",
            timezone: "Asia/Shanghai",
          },
        })),
      },
    });
    const memory = artifacts.files.find(({ relativePath }) =>
      relativePath === "MEMORY.md"
    );

    expect(memory?.content).toContain(
      "[occurrence: 2026-04-01T16:00:00.000Z..2026-04-02T16:00:00.000Z; precision=day; timezone=Asia/Shanghai]",
    );
  });

  it("namespaces session-scoped artifact bundles by session id", () => {
    const sessionOne = buildMarkdownArtifacts(buildProjectionInput());
    const sessionNine = buildMarkdownArtifacts({
      ...buildProjectionInput(),
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-9" },
    });

    expect(sessionOne.rootPath).not.toBe(sessionNine.rootPath);
  });

  it("renders domain metadata needed for memory auditability", () => {
    const input = buildProjectionInput();
    const artifacts = buildMarkdownArtifacts({
      ...input,
      durable: {
        ...input.durable,
        preferences: [
          createPreferenceMemory({
            ...input.durable.preferences[0]!,
            tags: ["style", "life_coach"],
            attributes: { cadence: "weekly" },
          }),
        ],
        references: [
          createReferenceMemory({
            ...input.durable.references[0]!,
            tags: ["runbook", "life_coach"],
            attributes: { owner: "Maya" },
          }),
        ],
        facts: [
          createFactMemory({
            ...input.durable.facts[0]!,
            tags: ["goal", "life_coach"],
            attributes: { horizon: "quarter" },
          }),
        ],
        feedback: [
          createFeedbackMemory({
            ...input.durable.feedback[0]!,
            tags: ["tone", "life_coach"],
            attributes: { source: "domain_rule" },
          }),
        ],
      },
    });
    const memoryArtifact = artifacts.files.find(
      (file) => file.relativePath === "MEMORY.md",
    );

    expect(memoryArtifact?.content).toContain(
      "- response_style: bullet points {tags: life_coach, style; attributes: cadence=weekly}",
    );
    expect(memoryArtifact?.content).toContain(
      "- [active] Migration rollout is blocked on prod verification. {tags: goal, life_coach; attributes: horizon=quarter}",
    );
    expect(memoryArtifact?.content).toContain(
      "- [active] Runbook (docs/runbook.md) {tags: life_coach, runbook; attributes: owner=Maya}",
    );
    expect(memoryArtifact?.content).toContain(
      "- [do] Keep answers concise. {tags: life_coach, tone; attributes: source=domain_rule}",
    );
  });

  it("exports active validated patterns as deterministic playbook artifacts with lineage", () => {
    const source = createMemorySource({
      method: "confirmed",
      extractedAt: "2026-04-02T00:00:00.000Z",
      sessionId: "s-1",
    });
    const artifacts = buildMarkdownArtifacts({
      ...buildProjectionInput(),
      durable: {
        ...buildProjectionInput().durable,
        feedback: [
          ...buildProjectionInput().durable.feedback,
          createFeedbackMemory({
            id: "pattern-1",
            userId: "u-1",
            workspaceId: "workspace-a",
            agentId: "agent-a",
            rule: "Use bullet points in summaries.",
            kind: "validated_pattern",
            appliesTo: "general_response",
            why: "Repeated successful summaries and explicit confirmations.",
            evidence: ["feedback-1", "proposal-1"],
            source,
            updatedAt: "2026-04-02T00:00:00.000Z",
          }),
        ],
      },
    });

    const playbook = artifacts.files.find((file) =>
      file.relativePath.startsWith("playbooks/"),
    );
    const promptSnippet = artifacts.files.find(
      (file) =>
        file.relativePath ===
        "playbooks/use-bullet-points-in-summaries.prompt.md",
    );
    const skillSnippet = artifacts.files.find(
      (file) =>
        file.relativePath ===
        "playbooks/use-bullet-points-in-summaries.skill.md",
    );

    expect(playbook?.kind).toBe("playbook");
    expect(playbook?.relativePath).toBe(
      "playbooks/use-bullet-points-in-summaries.md",
    );
    expect(playbook?.content).toContain("# Playbook: Use bullet points in summaries.");
    expect(playbook?.content).toContain("## Canonical Pattern");
    expect(playbook?.content).toContain("canonicalMemoryId: pattern-1");
    expect(playbook?.content).toContain("appliesTo: general_response");
    expect(playbook?.content).toContain(
      "Repeated successful summaries and explicit confirmations.",
    );
    expect(playbook?.content).toContain("evidenceIds: feedback-1, proposal-1");
    expect(promptSnippet?.kind).toBe("playbook");
    expect(promptSnippet?.content).toContain("# Prompt Snippet: Use bullet points in summaries.");
    expect(promptSnippet?.content).toContain("Use bullet points in summaries.");
    expect(skillSnippet?.kind).toBe("playbook");
    expect(skillSnippet?.content).toContain("# Skill Snippet: Use bullet points in summaries.");
    expect(skillSnippet?.content).toContain("appliesTo: general_response");
  });

  it("renders empty playbook Why sections without the ambiguous none placeholder", () => {
    const source = createMemorySource({
      method: "confirmed",
      extractedAt: "2026-04-02T00:00:00.000Z",
      sessionId: "s-1",
    });
    const artifacts = buildMarkdownArtifacts({
      ...buildProjectionInput(),
      durable: {
        ...buildProjectionInput().durable,
        feedback: [
          ...buildProjectionInput().durable.feedback,
          createFeedbackMemory({
            id: "pattern-empty-why",
            userId: "u-1",
            workspaceId: "workspace-a",
            agentId: "agent-a",
            rule: "Use bullet points in summaries.",
            kind: "validated_pattern",
            appliesTo: "general_response",
            source,
            updatedAt: "2026-04-02T00:00:00.000Z",
          }),
        ],
      },
    });
    const playbook = artifacts.files.find(
      (file) => file.relativePath === "playbooks/use-bullet-points-in-summaries.md",
    );

    expect(playbook?.content).toContain("## Why\n<!-- intentionally empty -->");
    expect(playbook?.content).not.toContain("## Why\n- none");
  });

  it("keeps prompt and skill snippet paths unique when duplicate playbook slugs need canonical suffixes", () => {
    const source = createMemorySource({
      method: "confirmed",
      extractedAt: "2026-04-02T00:00:00.000Z",
      sessionId: "s-1",
    });
    const artifacts = buildMarkdownArtifacts({
      ...buildProjectionInput(),
      durable: {
        ...buildProjectionInput().durable,
        feedback: [
          ...buildProjectionInput().durable.feedback,
          createFeedbackMemory({
            id: "pattern-1",
            userId: "u-1",
            workspaceId: "workspace-a",
            agentId: "agent-a",
            rule: "Use bullet points in summaries.",
            kind: "validated_pattern",
            appliesTo: "general_response",
            source,
            updatedAt: "2026-04-02T00:00:00.000Z",
          }),
          createFeedbackMemory({
            id: "pattern-2",
            userId: "u-1",
            workspaceId: "workspace-a",
            agentId: "agent-a",
            rule: "Use bullet points in summaries.",
            kind: "validated_pattern",
            appliesTo: "status_update",
            source,
            updatedAt: "2026-04-02T00:00:01.000Z",
          }),
        ],
      },
    });
    const playbookPaths = artifacts.files
      .filter((file) => file.relativePath.startsWith("playbooks/"))
      .map((file) => file.relativePath)
      .sort();

    expect(new Set(playbookPaths).size).toBe(playbookPaths.length);
    const canonicalPaths = playbookPaths.filter(
      (path) => path.endsWith(".md") && !path.endsWith(".prompt.md") && !path.endsWith(".skill.md"),
    );

    expect(canonicalPaths).toHaveLength(2);
    expect(canonicalPaths).toContain("playbooks/use-bullet-points-in-summaries.md");

    for (const canonicalPath of canonicalPaths) {
      const basePath = canonicalPath.slice(0, -".md".length);
      expect(playbookPaths).toContain(`${basePath}.prompt.md`);
      expect(playbookPaths).toContain(`${basePath}.skill.md`);
    }
  });

  it("does not treat spill-only runtime residue as an active session handoff", () => {
    const base = buildProjectionInput();
    const artifacts = buildMarkdownArtifacts({
      ...base,
      runtime: {
        workingMemory: null,
        journal: null,
        spills: base.runtime.spills,
      },
    });

    expect(artifacts.files.map((file) => file.relativePath)).toEqual([
      "user.md",
      "MEMORY.md",
      "archive/2026/04/s-1.md",
    ]);
  });

  it("escapes multiline memory content so markdown structure stays stable", () => {
    const artifacts = buildMarkdownArtifacts({
      ...buildProjectionInput(),
      durable: {
        ...buildProjectionInput().durable,
        facts: [
          createFactMemory({
            id: "fact-injected",
            userId: "u-1",
            workspaceId: "workspace-a",
            sessionId: "s-1",
            category: "project",
            content: "First line\n## Injected Heading\n- injected bullet",
            source: createMemorySource({
              method: "explicit",
              extractedAt: "2026-04-02T00:00:00.000Z",
              sessionId: "s-1",
            }),
            updatedAt: "2026-04-02T00:00:00.000Z",
            createdAt: "2026-04-02T00:00:00.000Z",
          }),
        ],
      },
    });

    expect(artifacts.files[1]?.content).toContain(
      "First line\\n## Injected Heading\\n- injected bullet",
    );
    expect(artifacts.files[1]?.content).not.toContain("\n## Injected Heading\n");
  });
});
