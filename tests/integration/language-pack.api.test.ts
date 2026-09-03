import { describe, expect, it } from "bun:test";

import {
  createGoodMemory,
  createNeutralLanguagePack,
  type LanguagePack,
} from "../../src";

describe("LanguagePack public API integration", () => {
  it("keeps a complete URL reference through the public remember API", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = { userId: "u-canonical-url", workspaceId: "workspace-a" };

    await memory.remember({
      messages: [{
        role: "user",
        content:
          "Use https://example.com/docs/runbook.md as the source of truth for deployment.",
      }],
      scope,
    });
    const exported = await memory.exportMemory({ scope });

    expect(exported.durable.references.map(({ pointer }) => pointer)).toEqual([
      "https://example.com/docs/runbook.md",
    ]);
  });

  it("uses the canonical reference parser through public remember for every built-in language", async () => {
    const cases = [
      {
        content:
          "Use https://example.com/文档/runbook.md as the source of truth.",
        expected: ["https://example.com/文档/runbook.md"],
        locale: "en-US",
      },
      {
        content: "现在以文档/运行手册.md为准。",
        expected: ["文档/运行手册.md"],
        locale: "zh-CN",
      },
      {
        content: "現在以文件/運行手冊.md為準。",
        expected: ["文件/運行手冊.md"],
        locale: "zh-TW",
      },
      {
        content: "https://example.com/資料/現在の手順書を正とする。",
        expected: ["https://example.com/資料/現在の手順書"],
        locale: "ja-JP",
      },
      {
        content: "문서/현재절차서.md를 현재 기준 문서로 사용합니다.",
        expected: ["문서/현재절차서.md"],
        locale: "ko-KR",
      },
      {
        content: "Utilise documents/guide-opérationnel.md comme source de vérité.",
        expected: ["documents/guide-opérationnel.md"],
        locale: "fr-FR",
      },
      {
        content: "Usa documentos/guía-operativa.md como la fuente de verdad.",
        expected: ["documentos/guía-operativa.md"],
        locale: "es-ES",
      },
      {
        content: "Use version 1.2 with Python 3.11.2.",
        expected: [],
        locale: "en-US",
      },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = {
        userId: `u-canonical-reference-${index}`,
        workspaceId: "workspace-a",
      };

      await memory.remember({
        locale: testCase.locale,
        messages: [{ role: "user", content: testCase.content }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });

      expect(exported.durable.references.map(({ pointer }) => pointer)).toEqual(
        [...testCase.expected],
      );
    }
  });

  it("normalizes existing facts with the pack that owns their raw text", async () => {
    const base = createNeutralLanguagePack();
    const sourcePack: LanguagePack = {
      ...base,
      compatibilityGroup: "test-canonical",
      defaultLocale: "eo",
      id: "test-source",
      locales: ["eo"],
      normalizeForEquality: (text) => text.toLowerCase().replaceAll("colour", "color"),
    };
    const incomingPack: LanguagePack = {
      ...base,
      compatibilityGroup: "test-canonical",
      defaultLocale: "vo",
      id: "test-incoming",
      locales: ["vo"],
      normalizeForEquality: (text) => text.toLowerCase(),
    };
    const memory = createGoodMemory({
      language: { packs: [sourcePack, incomingPack] },
      storage: { provider: "memory" },
    });
    const scope = { userId: "u-custom-pack", workspaceId: "workspace-a" };

    const first = await memory.remember({
      annotations: [{ messageIndex: 0, remember: "always", kindHint: "fact" }],
      locale: "eo",
      messages: [{ role: "user", content: "colour" }],
      scope,
    });
    const second = await memory.remember({
      annotations: [{ messageIndex: 0, remember: "always", kindHint: "fact" }],
      locale: "vo",
      messages: [{ role: "user", content: "color" }],
      scope,
    });
    const exported = await memory.exportMemory({ scope });

    expect(first.events.some(({ outcome }) => outcome === "written")).toBe(true);
    expect(second.events.some(({ outcome }) => outcome === "merged")).toBe(true);
    expect(exported.durable.facts).toHaveLength(1);
  });

  it("persists each mixed-language candidate with its source-message pack", async () => {
    const policyLocales: Array<{ content: string; locale: string }> = [];
    const memory = createGoodMemory({
      policy: {
        shouldRemember(candidate, context) {
          policyLocales.push({ content: candidate.content, locale: context.locale });
          return true;
        },
      },
      storage: { provider: "memory" },
    });
    const scope = { userId: "u-mixed-language", workspaceId: "workspace-a" };

    await memory.remember({
      messages: [
        { role: "user", content: "请记住我喜欢中文回复。" },
        { role: "user", content: "Use docs/runbook.md as the source of truth." },
      ],
      scope,
    });
    const exported = await memory.exportMemory({ scope });
    const chinese = [
      ...exported.durable.facts,
      ...exported.durable.preferences,
    ].find((record) => JSON.stringify(record).includes("中文回复"));
    const runbook = exported.durable.references.find(
      (record) => record.pointer === "docs/runbook.md",
    );

    expect(chinese?.source).toMatchObject({
      languagePackId: "zh-Hans",
      locale: "zh-CN",
    });
    expect(runbook?.source).toMatchObject({
      languagePackId: "en",
      locale: "en-US",
    });
    expect(
      policyLocales.find(({ content }) => content === "docs/runbook.md"),
    ).toMatchObject({ locale: "en-US" });
    expect(
      policyLocales.find(({ content }) => content.includes("中文回复")),
    ).toMatchObject({ locale: "zh-CN" });
  });

  it("remembers and recalls Traditional Chinese within the same script", async () => {
    const memory = createGoodMemory({
      language: { defaultLocale: "zh-TW" },
      retrieval: { preset: "recommended", recallPlanExecution: true },
      storage: { provider: "memory" },
    });
    const scope = { userId: "u-hant-api", sessionId: "s-hant-api" };

    const remembered = await memory.remember({
      locale: "zh-TW",
      scope,
      messages: [
        {
          role: "user",
          content: "請記住目前專案的阻塞是供應商審批。",
        },
      ],
    });
    const recalled = await memory.recall({
      locale: "zh-TW",
      query: "目前專案的阻塞是什麼？",
      scope,
    });

    expect(remembered.metadata).toMatchObject({
      languagePackId: "zh-Hant",
      languagePackVersion: "20-explicit-compound-facts",
      locale: "zh-TW",
    });
    expect(recalled.facts.some((fact) => fact.content.includes("供應商審批"))).toBe(
      true,
    );
    expect(recalled.metadata).toMatchObject({
      languagePackId: "zh-Hant",
      languagePackVersion: "20-explicit-compound-facts",
      locale: "zh-TW",
    });
  });

  it("does not create a false cross-script match through locale fallback", async () => {
    const memory = createGoodMemory({
      language: { defaultLocale: "zh-TW" },
      retrieval: { preset: "recommended", recallPlanExecution: true },
      storage: { provider: "memory" },
    });
    const scope = { userId: "u-script-local", sessionId: "s-script-local" };

    await memory.remember({
      annotations: [{ messageIndex: 0, remember: "always", kindHint: "fact" }],
      locale: "zh-TW",
      messages: [{ role: "user", content: "資料庫遷移採用藍綠策略。" }],
      scope,
    });
    const recalled = await memory.recall({
      locale: "zh-CN",
      query: "数据库迁移",
      scope,
    });

    expect(recalled.metadata).toMatchObject({
      languagePackId: "zh-Hans",
      locale: "zh-CN",
    });
    expect(recalled.facts).toHaveLength(0);
  });

  it("uses Japanese analysis, projection search, and context rendering end to end", async () => {
    const memory = createGoodMemory({
      language: { defaultLocale: "ja-JP" },
      retrieval: { preset: "recommended", recallPlanExecution: true },
      storage: { provider: "memory" },
    });
    const scope = { userId: "u-ja-api", sessionId: "s-ja-api" };

    await memory.remember({
      locale: "ja-JP",
      scope,
      messages: [
        {
          role: "user",
          content: "覚えておいて、現在のブロッカーは法務承認です。",
        },
      ],
    });
    const recalled = await memory.recall({
      locale: "ja-JP",
      query: "現在のブロッカーは何ですか？",
      scope,
    });
    const context = await memory.buildContext({
      output: "markdown",
      recall: recalled,
    });

    expect(recalled.facts.some((fact) => fact.content.includes("法務承認"))).toBe(
      true,
    );
    expect(context.content).toContain("## 事実");
    expect(context.content).toContain("法務承認");
  });

  for (const testCase of [
    {
      change: "後來改成哪個方案？",
      count: "總共有幾項待辦？",
      currentBlocker: "目前專案的阻礙是什麼？",
      history: "過去的專案狀態是什麼？",
      locale: "zh-TW",
      continuation: "繼續上次的工作。",
      reference: "應該參考哪份文件？",
    },
    {
      change: "その後、何に変更しましたか？",
      count: "未完了事項は何件ありますか？",
      currentBlocker: "現在のブロッカーは何ですか？",
      history: "過去のプロジェクト状態は何ですか？",
      locale: "ja-JP",
      continuation: "前回の続きから再開してください。",
      reference: "どの文書を参照すべきですか？",
    },
  ] as const) {
    it(`executes the complete ${testCase.locale} recall intent matrix`, async () => {
      const memory = createGoodMemory({
        retrieval: { recallPlanExecution: true },
        storage: { provider: "memory" },
        testing: {
          now: () => new Date("2026-07-16T00:00:00.000Z"),
        },
      });
      const scope = {
        userId: `u-matrix-${testCase.locale}`,
        sessionId: `s-matrix-${testCase.locale}`,
      };
      const recall = async (query: string) => {
        const result = await memory.recall({
          locale: testCase.locale,
          query,
          scope,
        });
        const trace = result.metadata.retrievalTrace;
        if (!trace || trace.schemaVersion !== 2) {
          throw new Error("Expected recall plan execution trace.");
        }
        return { result, plan: trace.plan };
      };

      expect((await recall(testCase.currentBlocker)).plan).toMatchObject({
        aggregation: "current",
        temporalConstraints: [{
          kind: "current",
          referenceTime: "2026-07-16T00:00:00.000Z",
        }],
      });
      expect((await recall(testCase.history)).plan.aggregation).toBe("history");
      expect((await recall(testCase.change)).plan.aggregation).toBe("change");
      expect((await recall(testCase.count)).plan.aggregation).toBe("count");

      const continuation = await recall(testCase.continuation);
      expect(continuation.result.metadata.routingDecision.continuation).toBe(true);
      expect(continuation.plan.planes).toContain("runtime");

      const reference = await recall(testCase.reference);
      expect(reference.result.metadata.routingDecision.referenceSeeking).toBe(true);
    });
  }
});
