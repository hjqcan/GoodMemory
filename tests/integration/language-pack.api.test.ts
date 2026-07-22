import { describe, expect, it } from "bun:test";

import {
  createGoodMemory,
  createNeutralLanguagePack,
  type LanguagePack,
} from "../../src";

describe("LanguagePack public API integration", () => {
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

  it("remembers Traditional Chinese and recalls it from a Simplified Chinese query", async () => {
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
      locale: "zh-CN",
      query: "目前项目的阻塞是什么？",
      scope,
    });

    expect(remembered.metadata).toMatchObject({
      languagePackId: "zh-Hant",
      languagePackVersion: "7-opencc-t2cn-1.4.1",
      locale: "zh-TW",
    });
    expect(recalled.facts.some((fact) => fact.content.includes("供應商審批"))).toBe(
      true,
    );
    expect(recalled.metadata).toMatchObject({
      languagePackId: "zh-Hans",
      languagePackVersion: "7-opencc-t2cn-1.4.1",
      locale: "zh-CN",
    });
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
});
