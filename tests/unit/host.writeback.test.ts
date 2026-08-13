import { describe, expect, it } from "bun:test";
import {
  createGoodMemory,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createMemorySource,
  createFeedbackMemory,
} from "../../src";
import type {
  FeedbackMemory,
} from "../../src";
import {
  EXPERIENCES_COLLECTION,
  type ExperienceRecord,
} from "../../src/evolution/contracts";
import { createDeterministicIdGenerator } from "../../src/testing/utils";
import {
  createHostAdapter,
  HostAdapterWriteError,
} from "../../src/host";

function slugifyRule(rule: string): string {
  const slug = rule
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "playbook";
}

async function createWritableHarness(options: {
  locale?: string;
  rule?: string;
  why?: string | null;
} = {}) {
  const documentStore = createInMemoryDocumentStore();
  const sessionStore = createInMemorySessionStore();
  const memory = createGoodMemory({
    ...(options.locale
      ? { language: { defaultLocale: options.locale } }
      : {}),
    storage: { provider: "memory" },
    adapters: {
      documentStore,
      sessionStore,
    },
  });

  await documentStore.set(
    "feedback",
    "pattern-1",
    createFeedbackMemory({
      id: "pattern-1",
      userId: "u-1",
      workspaceId: "workspace-a",
      agentId: "agent-a",
      rule: options.rule ?? "Use bullet points in summaries.",
      kind: "validated_pattern",
      appliesTo: "general_response",
      ...(options.why === null
        ? {}
        : {
            why:
              options.why ?? "Repeated successful summaries and explicit confirmations.",
          }),
      evidence: ["feedback-1", "proposal-1"],
      source: createMemorySource({
        method: "confirmed",
        extractedAt: "2026-04-20T00:00:00.000Z",
        sessionId: "s-1",
        ...(options.locale
          ? { locale: options.locale, localeSource: "explicit" as const }
          : {}),
      }),
      updatedAt: "2026-04-20T00:00:00.000Z",
    }),
  );

  const scope = {
    userId: "u-1",
    workspaceId: "workspace-a",
    agentId: "agent-a",
  } as const;

  const exported = await memory.exportMemory({
    scope,
    ...(options.locale ? { locale: options.locale } : {}),
  });
  const playbook = exported.artifacts.files.find(
    (file) => file.relativePath === `playbooks/${slugifyRule(options.rule ?? "Use bullet points in summaries.")}.md`,
  );

  if (!playbook) {
    throw new Error("expected compiled playbook");
  }

  return {
    documentStore,
    memory,
    playbook,
    scope,
    sessionStore,
  };
}

describe("host adapter writeback", () => {
  it("round-trips localized authoritative playbooks through the matching pack parser", async () => {
    const cases = [
      {
        locale: "zh-Hant",
        rule: "請在摘要中使用項目符號。",
        why: "使用者已確認這項偏好。",
        nextWhy: "使用者再次確認這項偏好。",
        headings: ["# 操作手冊：", "## 規範模式", "## 指引", "## 原因"],
      },
      {
        locale: "ja-JP",
        rule: "要約では箇条書きを使ってください。",
        why: "ユーザーがこの設定を確認しました。",
        nextWhy: "ユーザーがこの設定を再確認しました。",
        headings: ["# プレイブック: ", "## 正規パターン", "## ガイダンス", "## 理由"],
      },
      {
        locale: "ko-KR",
        rule: "요약에는 글머리 기호를 사용하세요.",
        why: "사용자가 이 선호 사항을 확인했습니다.",
        nextWhy: "사용자가 이 선호 사항을 다시 확인했습니다.",
        headings: ["# 플레이북: ", "## 정규 패턴", "## 지침", "## 이유"],
      },
      {
        locale: "fr-FR",
        rule: "Utilisez des listes à puces dans les résumés.",
        why: "L’utilisateur a confirmé cette préférence.",
        nextWhy: "L’utilisateur a confirmé cette préférence à nouveau.",
        headings: [
          "# Guide opérationnel : ",
          "## Modèle canonique",
          "## Directive",
          "## Pourquoi",
        ],
      },
      {
        locale: "es-ES",
        rule: "Usa listas con viñetas en los resúmenes.",
        why: "El usuario confirmó esta preferencia.",
        nextWhy: "El usuario volvió a confirmar esta preferencia.",
        headings: ["# Manual: ", "## Patrón canónico", "## Guía", "## Motivo"],
      },
    ] as const;

    for (const entry of cases) {
      const { documentStore, memory, playbook, scope } =
        await createWritableHarness(entry);
      for (const heading of entry.headings) {
        expect(playbook.content).toContain(heading);
      }
      expect(playbook.content).toContain("canonicalMemoryId: pattern-1");
      expect(playbook.content).toContain("appliesTo: general_response");

      const adapter = createHostAdapter({
        documentStore,
        hostKind: "codex",
        id: `codex-${entry.locale}-writer`,
        memory,
        mode: "file-authoritative",
        now: () => "2026-04-21T00:00:00.000Z",
        readableArtifactTypes: ["playbook"],
        supportedReadableArtifactTypes: ["playbook"],
        writableArtifactTypes: ["playbook"],
      });
      const result = await adapter.writeArtifact({
        artifactType: "playbook",
        content: playbook.content.replace(entry.why, entry.nextWhy),
        relativePath: playbook.relativePath,
        scope,
      });
      const updated = await documentStore.get<FeedbackMemory>(
        "feedback",
        "pattern-1",
      );

      expect(result.status).toBe("applied");
      expect(updated?.why).toBe(entry.nextWhy);
    }
  });

  it("passes persisted locale provenance to writeback policy hooks", async () => {
    const { documentStore, memory, playbook, scope } = await createWritableHarness();
    const existing = await documentStore.get<FeedbackMemory>("feedback", "pattern-1");
    if (!existing) {
      throw new Error("expected writable feedback");
    }
    await documentStore.set("feedback", existing.id, {
      ...existing,
      source: createMemorySource({
        ...existing.source,
        locale: "ja-JP",
        localeSource: "detected",
        languagePackId: "ja",
        languagePackVersion: "1",
      }),
    });
    let observedLocaleSource: string | undefined;
    const adapter = createHostAdapter({
      id: "codex-language-policy",
      hostKind: "codex",
      mode: "file-authoritative",
      memory,
      documentStore,
      readableArtifactTypes: ["playbook"],
      supportedReadableArtifactTypes: ["playbook"],
      writableArtifactTypes: ["playbook"],
      policy: {
        redact(candidate, context) {
          observedLocaleSource = context.localeSource;
          return candidate;
        },
      },
      now: () => "2026-04-21T00:00:00.000Z",
    });
    const changedWhy = playbook.content.replace(
      "Repeated successful summaries and explicit confirmations.",
      "Japanese workflow guidance confirmed by the user.",
    );

    await adapter.writeArtifact({
      scope,
      artifactType: "playbook",
      relativePath: playbook.relativePath,
      content: changedWhy,
    });

    expect(observedLocaleSource).toBe("detected");
  });

  it("resolves missing writeback locale from the existing localized rule", async () => {
    const rule = "要点を箇条書きにしてください。";
    const { documentStore, memory, playbook, scope } = await createWritableHarness({
      rule,
    });
    let observedLocale: string | undefined;
    let observedLocaleSource: string | undefined;
    const adapter = createHostAdapter({
      id: "codex-detected-language-policy",
      hostKind: "codex",
      mode: "file-authoritative",
      memory,
      documentStore,
      readableArtifactTypes: ["playbook"],
      supportedReadableArtifactTypes: ["playbook"],
      writableArtifactTypes: ["playbook"],
      policy: {
        redact(candidate, context) {
          observedLocale = context.locale;
          observedLocaleSource = context.localeSource;
          return candidate;
        },
      },
      now: () => "2026-04-21T00:00:00.000Z",
    });

    await adapter.writeArtifact({
      scope,
      artifactType: "playbook",
      relativePath: playbook.relativePath,
      content: playbook.content.replace(rule, "要点を短い箇条書きにしてください。"),
    });

    expect(observedLocale).toBe("ja-JP");
    expect(observedLocaleSource).toBe("detected");
  });

  it("writes low-risk playbook metadata deltas back into canonical validated patterns", async () => {
    const { documentStore, memory, playbook, scope } = await createWritableHarness();
    const adapter = createHostAdapter({
      id: "codex-writer",
      hostKind: "codex",
      mode: "file-authoritative",
      memory,
      documentStore,
      readableArtifactTypes: ["playbook"],
      supportedReadableArtifactTypes: ["playbook"],
      writableArtifactTypes: ["playbook"],
      createId: createDeterministicIdGenerator("host"),
      now: () => "2026-04-21T00:00:00.000Z",
    });

    const updatedContent = playbook.content.replace(
      "Repeated successful summaries and explicit confirmations.",
      "Prefer concise bullet summaries when the user asks for a project update.",
    ).replace(
      "appliesTo: general_response",
      "appliesTo: project_summary",
    );

    const result = await adapter.writeArtifact({
      scope,
      artifactType: "playbook",
      relativePath: playbook.relativePath,
      content: updatedContent,
    });

    expect(result.status).toBe("applied");
    expect(result.diagnostics.verificationOutcome).toBe("not_run");
    expect(result.diagnostics.policyApplied).toEqual([]);
    expect(result.diagnostics.structuredDelta).toEqual([
      { op: "set", target: "appliesTo", value: "project_summary" },
      {
        op: "set",
        target: "why",
        value: "Prefer concise bullet summaries when the user asks for a project update.",
      },
    ]);
    expect(result.updatedArtifact.relativePath).toBe(playbook.relativePath);
    expect(result.linkedExperienceId).toBe("host-0001");

    const updated = await documentStore.get<FeedbackMemory>("feedback", "pattern-1");
    expect(updated?.appliesTo).toBe("project_summary");
    expect(updated?.why).toBe(
      "Prefer concise bullet summaries when the user asks for a project update.",
    );

    const experiences = await documentStore.query<ExperienceRecord>(EXPERIENCES_COLLECTION, {
      userId: "u-1",
    });
    expect(experiences).toHaveLength(1);
    expect(experiences[0]?.linkedMemoryIds).toEqual(["pattern-1"]);
    expect(experiences[0]?.summary).toContain("codex-writer");
  });

  it("keeps unchanged playbooks with an empty Why section idempotent", async () => {
    const { documentStore, memory, playbook, scope } = await createWritableHarness({
      why: null,
    });
    const adapter = createHostAdapter({
      id: "codex-empty-why-noop",
      hostKind: "codex",
      mode: "file-authoritative",
      memory,
      documentStore,
      readableArtifactTypes: ["playbook"],
      supportedReadableArtifactTypes: ["playbook"],
      writableArtifactTypes: ["playbook"],
      createId: createDeterministicIdGenerator("noop"),
      now: () => "2026-04-21T00:00:00.000Z",
    });

    const result = await adapter.writeArtifact({
      scope,
      artifactType: "playbook",
      relativePath: playbook.relativePath,
      content: playbook.content,
    });

    expect(result.status).toBe("noop");
    expect(result.diagnostics.structuredDelta).toEqual([]);
    const unchanged = await documentStore.get<FeedbackMemory>("feedback", "pattern-1");
    expect(unchanged?.why).toBeUndefined();
    const experiences = await documentStore.query<ExperienceRecord>(EXPERIENCES_COLLECTION, {
      userId: "u-1",
    });
    expect(experiences).toHaveLength(0);
  });

  it("preserves a literal guidance rule of none on unrelated metadata edits", async () => {
    const { documentStore, memory, playbook, scope } = await createWritableHarness({
      rule: "none",
    });
    const adapter = createHostAdapter({
      id: "codex-literal-none-rule",
      hostKind: "codex",
      mode: "file-authoritative",
      memory,
      documentStore,
      readableArtifactTypes: ["playbook"],
      supportedReadableArtifactTypes: ["playbook"],
      writableArtifactTypes: ["playbook"],
      now: () => "2026-04-21T00:00:00.000Z",
    });
    const changedAppliesTo = playbook.content.replace(
      "appliesTo: general_response",
      "appliesTo: checklist",
    );

    const result = await adapter.writeArtifact({
      scope,
      artifactType: "playbook",
      relativePath: playbook.relativePath,
      content: changedAppliesTo,
    });

    expect(result.status).toBe("applied");
    const updated = await documentStore.get<FeedbackMemory>("feedback", "pattern-1");
    expect(updated?.rule).toBe("none");
    expect(updated?.appliesTo).toBe("checklist");
  });

  it("preserves a literal Why value of none on unrelated metadata edits", async () => {
    const { documentStore, memory, playbook, scope } = await createWritableHarness({
      why: "none",
    });
    const adapter = createHostAdapter({
      id: "codex-literal-none-why",
      hostKind: "codex",
      mode: "file-authoritative",
      memory,
      documentStore,
      readableArtifactTypes: ["playbook"],
      supportedReadableArtifactTypes: ["playbook"],
      writableArtifactTypes: ["playbook"],
      now: () => "2026-04-21T00:00:00.000Z",
    });
    const changedAppliesTo = playbook.content.replace(
      "appliesTo: general_response",
      "appliesTo: checklist",
    );

    const result = await adapter.writeArtifact({
      scope,
      artifactType: "playbook",
      relativePath: playbook.relativePath,
      content: changedAppliesTo,
    });

    expect(result.status).toBe("applied");
    const updated = await documentStore.get<FeedbackMemory>("feedback", "pattern-1");
    expect(updated?.why).toBe("none");
    expect(updated?.appliesTo).toBe("checklist");
  });

  it("blocks risky rule changes until verification explicitly passes", async () => {
    const { documentStore, memory, playbook, scope } = await createWritableHarness();
    const adapter = createHostAdapter({
      id: "claude-writer",
      hostKind: "claude",
      mode: "file-authoritative",
      memory,
      documentStore,
      readableArtifactTypes: ["playbook"],
      supportedReadableArtifactTypes: ["playbook"],
      writableArtifactTypes: ["playbook"],
      now: () => "2026-04-21T00:00:00.000Z",
    });

    const changedRule = playbook.content.replace(
      "- Use bullet points in summaries.",
      "- Use numbered lists in summaries.",
    );

    try {
      await adapter.writeArtifact({
        scope,
        artifactType: "playbook",
        relativePath: playbook.relativePath,
        content: changedRule,
      });
      throw new Error("expected host write to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(HostAdapterWriteError);
      const writeError = error as HostAdapterWriteError;

      expect(writeError.diagnostics.verificationOutcome).toBe("review_required");
      expect(writeError.diagnostics.failureReasons).toContain(
        "Risky adapter writes require verification before they can be applied.",
      );
      expect(writeError.diagnostics.rollback.mode).toBe("file-assisted");
    }

    const unchanged = await documentStore.get<FeedbackMemory>("feedback", "pattern-1");
    expect(unchanged?.rule).toBe("Use bullet points in summaries.");
  });

  it("applies verification-approved writes and preserves redaction diagnostics", async () => {
    const { documentStore, memory, playbook, scope } = await createWritableHarness();
    const adapter = createHostAdapter({
      id: "codex-verified-writer",
      hostKind: "codex",
      mode: "file-authoritative",
      memory,
      documentStore,
      readableArtifactTypes: ["playbook"],
      supportedReadableArtifactTypes: ["playbook"],
      writableArtifactTypes: ["playbook"],
      createId: createDeterministicIdGenerator("verified"),
      now: () => "2026-04-21T00:00:00.000Z",
      policy: {
        redact(candidate) {
          return {
            ...candidate,
            content: "Use numbered lists in summaries.",
          };
        },
      },
      verifyWrite() {
        return {
          outcome: "passed",
          reason: "Pattern change approved after manual review.",
        };
      },
    });

    const changedRule = playbook.content.replace(
      "- Use bullet points in summaries.",
      "- Use numbered lists in summaries, but keep them short.",
    );

    const result = await adapter.writeArtifact({
      scope,
      artifactType: "playbook",
      relativePath: playbook.relativePath,
      content: changedRule,
    });

    expect(result.diagnostics.verificationOutcome).toBe("passed");
    expect(result.diagnostics.policyApplied).toContain("custom_redact");
    expect(result.updatedArtifact.relativePath).toBe(
      "playbooks/use-numbered-lists-in-summaries.md",
    );

    const updated = await documentStore.get<FeedbackMemory>("feedback", "pattern-1");
    expect(updated?.rule).toBe("Use numbered lists in summaries.");
  });

  it("treats policy metadata removal as authoritative during host writeback", async () => {
    const { documentStore, memory, playbook, scope } = await createWritableHarness();
    const adapter = createHostAdapter({
      id: "codex-metadata-redaction",
      hostKind: "codex",
      mode: "file-authoritative",
      memory,
      documentStore,
      readableArtifactTypes: ["playbook"],
      supportedReadableArtifactTypes: ["playbook"],
      writableArtifactTypes: ["playbook"],
      now: () => "2026-04-21T00:00:00.000Z",
      policy: {
        redact(candidate) {
          return { ...candidate, metadata: undefined };
        },
      },
    });

    const result = await adapter.writeArtifact({
      scope,
      artifactType: "playbook",
      relativePath: playbook.relativePath,
      content: playbook.content.replace(
        "Repeated successful summaries and explicit confirmations.",
        "The user confirmed this pattern again.",
      ),
    });
    const updated = await documentStore.get<FeedbackMemory>("feedback", "pattern-1");

    expect(result.status).toBe("applied");
    expect(updated?.kind).toBe("validated_pattern");
    expect(updated?.appliesTo).toBeUndefined();
  });

  it("rejects storage-unsafe playbook fields before host writeback", async () => {
    const { documentStore, memory, playbook, scope } = await createWritableHarness();
    const adapter = createHostAdapter({
      id: "codex-storage-safe-writer",
      hostKind: "codex",
      mode: "file-authoritative",
      memory,
      documentStore,
      readableArtifactTypes: ["playbook"],
      supportedReadableArtifactTypes: ["playbook"],
      writableArtifactTypes: ["playbook"],
      now: () => "2026-04-21T00:00:00.000Z",
    });

    await expect(
      adapter.writeArtifact({
        scope,
        artifactType: "playbook",
        relativePath: playbook.relativePath,
        content: playbook.content.replace(
          "Repeated successful summaries and explicit confirmations.",
          "unsafe\0why",
        ),
      }),
    ).rejects.toThrow("Storage-unsafe text at writeInput.content");

    const unchanged = await documentStore.get<FeedbackMemory>("feedback", "pattern-1");
    const experiences = await documentStore.query<ExperienceRecord>(
      EXPERIENCES_COLLECTION,
      { userId: "u-1" },
    );
    expect(unchanged?.why).toBe(
      "Repeated successful summaries and explicit confirmations.",
    );
    expect(experiences).toHaveLength(0);
  });

  it("applies resolveConflict before mutating canonical playbook state", async () => {
    const { documentStore, memory, playbook, scope } = await createWritableHarness();
    const adapter = createHostAdapter({
      id: "codex-resolve-conflict",
      hostKind: "codex",
      mode: "file-authoritative",
      memory,
      documentStore,
      readableArtifactTypes: ["playbook"],
      supportedReadableArtifactTypes: ["playbook"],
      writableArtifactTypes: ["playbook"],
      now: () => "2026-04-21T00:00:00.000Z",
      policy: {
        resolveConflict() {
          return {
            action: "keep_existing",
            reason: "Conflict policy keeps the existing canonical playbook.",
          };
        },
      },
    });
    const changedWhy = playbook.content.replace(
      "Repeated successful summaries and explicit confirmations.",
      "Host write wants to change the rationale.",
    );

    try {
      await adapter.writeArtifact({
        scope,
        artifactType: "playbook",
        relativePath: playbook.relativePath,
        content: changedWhy,
      });
      throw new Error("expected resolveConflict to block host write");
    } catch (error) {
      expect(error).toBeInstanceOf(HostAdapterWriteError);
      const writeError = error as HostAdapterWriteError;

      expect(writeError.diagnostics.failureReasons).toContain(
        "Conflict policy keeps the existing canonical playbook.",
      );
      expect(writeError.diagnostics.policyApplied).toContain("custom_resolveConflict");
    }

    const unchanged = await documentStore.get<FeedbackMemory>("feedback", "pattern-1");
    expect(unchanged?.why).toBe("Repeated successful summaries and explicit confirmations.");
  });

  it("rejects malformed playbook files with useful diagnostics", async () => {
    const { documentStore, memory, playbook, scope } = await createWritableHarness();
    const adapter = createHostAdapter({
      id: "codex-malformed",
      hostKind: "codex",
      mode: "file-authoritative",
      memory,
      documentStore,
      readableArtifactTypes: ["playbook"],
      supportedReadableArtifactTypes: ["playbook"],
      writableArtifactTypes: ["playbook"],
      now: () => "2026-04-21T00:00:00.000Z",
    });

    const malformed = playbook.content.replace("- canonicalMemoryId: pattern-1\n", "");

    try {
      await adapter.writeArtifact({
        scope,
        artifactType: "playbook",
        relativePath: playbook.relativePath,
        content: malformed,
      });
      throw new Error("expected malformed playbook to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(HostAdapterWriteError);
      const writeError = error as HostAdapterWriteError;

      expect(writeError.diagnostics.failureReasons).toContain(
        "Playbook writeback requires canonicalMemoryId in the Canonical Pattern section.",
      );
      expect(writeError.diagnostics.structuredDelta).toEqual([]);
    }
  });

  it("fails closed on unsupported multi-bullet authoritative edits", async () => {
    const { documentStore, memory, playbook, scope } = await createWritableHarness();
    const adapter = createHostAdapter({
      id: "codex-multi-bullet",
      hostKind: "codex",
      mode: "file-authoritative",
      memory,
      documentStore,
      readableArtifactTypes: ["playbook"],
      supportedReadableArtifactTypes: ["playbook"],
      writableArtifactTypes: ["playbook"],
      now: () => "2026-04-21T00:00:00.000Z",
    });
    const variants = [
      {
        content: playbook.content.replace(
          "## Guidance\n- Use bullet points in summaries.",
          "## Guidance\n- Use bullet points in summaries.\n- Keep them short.",
        ),
        expectedReason:
          "Playbook writeback only supports a single guidance bullet in the Guidance section.",
      },
      {
        content: playbook.content.replace(
          "## Why\n- Repeated successful summaries and explicit confirmations.",
          "## Why\n- Repeated successful summaries and explicit confirmations.\n- Secondary rationale.",
        ),
        expectedReason:
          "Playbook writeback only supports zero or one Why bullet in the Why section.",
      },
    ];

    for (const variant of variants) {
      try {
        await adapter.writeArtifact({
          scope,
          artifactType: "playbook",
          relativePath: playbook.relativePath,
          content: variant.content,
        });
        throw new Error("expected multi-bullet authoritative edit to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(HostAdapterWriteError);
        const writeError = error as HostAdapterWriteError;

        expect(writeError.diagnostics.failureReasons).toContain(variant.expectedReason);
      }
    }
  });

  it("rejects canonicalMemoryId tampering that does not match the current playbook path binding", async () => {
    const { documentStore, memory, playbook, scope } = await createWritableHarness();

    await documentStore.set(
      "feedback",
      "pattern-2",
      createFeedbackMemory({
        id: "pattern-2",
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        rule: "Use bullet points in summaries.",
        kind: "validated_pattern",
        appliesTo: "general_response",
        why: "Old superseded sibling that must stay immutable from this file path.",
        source: createMemorySource({
          method: "confirmed",
          extractedAt: "2026-04-19T00:00:00.000Z",
          sessionId: "s-0",
        }),
        lifecycle: "superseded",
        supersededBy: "pattern-1",
        updatedAt: "2026-04-19T00:00:00.000Z",
      }),
    );

    const adapter = createHostAdapter({
      id: "codex-binding-check",
      hostKind: "codex",
      mode: "file-authoritative",
      memory,
      documentStore,
      readableArtifactTypes: ["playbook"],
      supportedReadableArtifactTypes: ["playbook"],
      writableArtifactTypes: ["playbook"],
      now: () => "2026-04-21T00:00:00.000Z",
    });

    const tamperedContent = playbook.content
      .replace("canonicalMemoryId: pattern-1", "canonicalMemoryId: pattern-2")
      .replace(
        "Repeated successful summaries and explicit confirmations.",
        "Tampered writeback should never retarget a sibling record.",
      );

    try {
      await adapter.writeArtifact({
        scope,
        artifactType: "playbook",
        relativePath: playbook.relativePath,
        content: tamperedContent,
      });
      throw new Error("expected canonical binding tampering to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(HostAdapterWriteError);
      const writeError = error as HostAdapterWriteError;

      expect(writeError.diagnostics.failureReasons).toContain(
        "Edited playbook canonicalMemoryId must match the current artifact bound to this path.",
      );
    }

    const active = await documentStore.get<FeedbackMemory>("feedback", "pattern-1");
    const superseded = await documentStore.get<FeedbackMemory>("feedback", "pattern-2");
    expect(active?.why).toBe("Repeated successful summaries and explicit confirmations.");
    expect(superseded?.why).toBe(
      "Old superseded sibling that must stay immutable from this file path.",
    );
  });

  it("rolls back canonical updates when adapter provenance logging fails", async () => {
    const { memory, playbook, scope } = await createWritableHarness();
    const failingDocumentStore = createInMemoryDocumentStore();
    const seedSource = createMemorySource({
      method: "confirmed",
      extractedAt: "2026-04-20T00:00:00.000Z",
      sessionId: "s-1",
    });

    await failingDocumentStore.set(
      "feedback",
      "pattern-1",
      createFeedbackMemory({
        id: "pattern-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        rule: "Use bullet points in summaries.",
        kind: "validated_pattern",
        appliesTo: "general_response",
        why: "Repeated successful summaries and explicit confirmations.",
        source: seedSource,
        updatedAt: "2026-04-20T00:00:00.000Z",
      }),
    );

    const documentStore = {
      ...failingDocumentStore,
      async set(collection: string, id: string, document: object) {
        if (collection === EXPERIENCES_COLLECTION) {
          throw new Error("experience write failed");
        }

        return failingDocumentStore.set(collection, id, document);
      },
    };

    const adapter = createHostAdapter({
      id: "codex-rollback",
      hostKind: "codex",
      mode: "file-authoritative",
      memory,
      documentStore,
      readableArtifactTypes: ["playbook"],
      supportedReadableArtifactTypes: ["playbook"],
      writableArtifactTypes: ["playbook"],
      createId: createDeterministicIdGenerator("rollback"),
      now: () => "2026-04-21T00:00:00.000Z",
    });

    const changedWhy = playbook.content.replace(
      "Repeated successful summaries and explicit confirmations.",
      "A new host-authored reason that should be rolled back.",
    );

    try {
      await adapter.writeArtifact({
        scope,
        artifactType: "playbook",
        relativePath: playbook.relativePath,
        content: changedWhy,
      });
      throw new Error("expected rollback case to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(HostAdapterWriteError);
      const writeError = error as HostAdapterWriteError;

      expect(writeError.diagnostics.rollback.performed).toBeTrue();
      expect(writeError.diagnostics.failureReasons).toContain("experience write failed");
    }

    const restored = await failingDocumentStore.get<FeedbackMemory>("feedback", "pattern-1");
    expect(restored?.why).toBe("Repeated successful summaries and explicit confirmations.");
  });
});
