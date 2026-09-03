import { describe, expect, it } from "bun:test";

import { createGoodMemory } from "../../src";

const CASES = [
  [
    "en-US",
    "Remember that my editor is Neovim, project code is Nightjar",
    ["my editor is Neovim", "project code is Nightjar"],
  ],
  [
    "zh-CN",
    "请记住：我的编辑器是 Neovim，项目代号是 Nightjar。",
    ["我的编辑器是 Neovim", "项目代号是 Nightjar"],
  ],
  [
    "zh-TW",
    "請記住：我的編輯器是 Neovim，專案代號是 Nightjar。",
    ["我的編輯器是 Neovim", "專案代號是 Nightjar"],
  ],
  [
    "fr-FR",
    "Souviens-toi : mon éditeur est Neovim, le code projet est Nightjar",
    ["mon éditeur est Neovim", "le code projet est Nightjar"],
  ],
  [
    "es-ES",
    "Recuerda: mi editor es Neovim, el código de proyecto es Nightjar",
    ["mi editor es Neovim", "el código de proyecto es Nightjar"],
  ],
  [
    "ja-JP",
    "覚えておいて：私のエディタはNeovim、プロジェクトコードはNightjar。",
    ["私のエディタはNeovim", "プロジェクトコードはNightjar"],
  ],
  [
    "ko-KR",
    "기억해 주세요: 제 편집기는 Neovim, 프로젝트 코드는 Nightjar입니다",
    ["제 편집기는 Neovim", "프로젝트 코드는 Nightjar"],
  ],
] as const;

describe("public explicit compound fact admission", () => {
  for (const [index, [locale, content, expected]] of CASES.entries()) {
    it(`${locale} persists two clean facts`, async () => {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: `explicit-compound-public-${index}` };

      const result = await memory.remember({
        locale,
        messages: [{ content, role: "user" }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });

      expect(result.accepted).toBe(2);
      expect(exported.durable.facts.map(({ content: fact }) => fact)).toEqual([
        ...expected,
      ]);
      const sourceMessages = exported.durable.sourceMessages ?? [];
      expect(sourceMessages).toHaveLength(1);
      expect(exported.durable.evidence).toHaveLength(2);
      const sourceMessageId = sourceMessages[0]!.id;
      expect(exported.durable.evidence.every(({ sourceMessageIds }) =>
        sourceMessageIds.length === 1 &&
        sourceMessageIds[0] === sourceMessageId
      )).toBeTrue();
      expect(exported.durable.evidence.flatMap(({ linkedMemoryIds }) =>
        linkedMemoryIds
      ).sort()).toEqual(exported.durable.facts.map(({ id }) => id).sort());
    });
  }

  it("auto-detects Chinese and keeps the incident probes out of durable memory", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = { userId: "incident-probes-auto-detection" };

    const results = await Promise.all([
      "我昨天吃了什么",
      "请用 read 工具读取 hello.txt 的内容，并把其中的标记原样告诉我。",
    ].map((content) => memory.remember({
      messages: [{ content, role: "user" }],
      scope,
    })));
    const exported = await memory.exportMemory({ scope });

    expect(results.map(({ accepted }) => accepted)).toEqual([0, 0]);
    expect(exported.durable.facts).toEqual([]);
    expect(exported.durable.feedback).toEqual([]);
  });
});

