import { describe, expect, it } from "bun:test";

import { createGoodMemory } from "../../src";

const CASES = [
  {
    adversarialOneOff: [
      "Please write mode=fast to config.txt.",
      "Please inspect the repository.",
      "Please, inspect the repository.",
      "Fix the bug.",
      "Summarize the repository.",
      "Implement this plan.",
    ],
    durable: "From now on, always use bullet points in status updates.",
    locale: "en-US",
    oneOff: "Please use the read tool to read hello.txt.",
  },
  {
    adversarialOneOff: [
      "请写入 mode=fast 到 config.txt。",
      "请把 mode=fast 写入 config.txt。",
      "请检查当前仓库。",
      "请，检查当前仓库。",
      "修复这个问题。",
      "实现这个计划。",
      "解释这段代码。",
    ],
    durable: "以后汇报状态时始终使用要点。",
    locale: "zh-CN",
    oneOff: "请用 read 工具读取 hello.txt 的内容，并把其中的标记原样告诉我。",
  },
  {
    adversarialOneOff: [
      "請寫入 mode=fast 到 config.txt。",
      "請把 mode=fast 寫入 config.txt。",
      "請檢查目前倉庫。",
      "請，檢查目前倉庫。",
      "修復這個問題。",
      "實現這個計畫。",
      "解釋這段代碼。",
    ],
    durable: "以後彙報狀態時始終使用要點。",
    locale: "zh-TW",
    oneOff: "請用 read 工具讀取 hello.txt 的內容，並把其中的標記原樣告訴我。",
  },
  {
    adversarialOneOff: [
      "Veuillez écrire mode=fast dans config.txt.",
      "Veuillez vérifier le dépôt.",
      "S’il vous plaît, vérifiez le dépôt.",
      "Corrigez le bug.",
      "Expliquez ce code.",
      "Ajoutez un test.",
    ],
    durable: "Désormais, utilisez toujours des listes pour les statuts.",
    locale: "fr-FR",
    oneOff: "Veuillez utiliser l’outil read pour lire hello.txt.",
  },
  {
    adversarialOneOff: [
      "Por favor, escribe mode=fast en config.txt.",
      "Verifica el repositorio.",
      "Por favor, verifica el repositorio.",
      "Corrige el error.",
      "Explica este código.",
      "Añade una prueba.",
    ],
    durable: "A partir de ahora, usa siempre viñetas en los estados.",
    locale: "es-ES",
    oneOff: "Por favor, usa la herramienta read para leer hello.txt.",
  },
  {
    adversarialOneOff: [
      "config.txtにmode=fastを書いてください。",
      "リポジトリの確認願います。",
      "お願いします、リポジトリを確認してください。",
      "バグを修正してください。",
      "バグを直せ。",
      "この仕様を説明せよ。",
      "ファイルを書くな。",
    ],
    durable: "今後はステータス報告で必ず箇条書きを使ってください。",
    locale: "ja-JP",
    oneOff: "readツールでhello.txtを読んでください。",
  },
  {
    adversarialOneOff: [
      "config.txt에 mode=fast를 써 주세요.",
      "저장소 확인 부탁드립니다.",
      "부탁드립니다, 저장소를 확인해 주세요.",
      "버그를 수정하세요.",
      "버그를 수정해.",
      "이 코드를 설명해.",
      "파일을 쓰지 마.",
    ],
    durable: "앞으로 상태 보고에는 항상 글머리표를 사용해 주세요.",
    locale: "ko-KR",
    oneOff: "read 도구로 hello.txt를 읽어 주세요.",
  },
] as const;

describe("public behavioral directive admission", () => {
  it("auto-detects durable Simplified and Traditional Chinese rules", async () => {
    for (const [index, content] of [
      "以后汇报状态时始终使用要点。",
      "以後彙報狀態時始終使用要點。",
    ].entries()) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: `auto-detected-chinese-directive-${index}` };

      const result = await memory.remember({
        messages: [{ content, role: "user" }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });

      expect(result.accepted).toBe(1);
      expect(exported.durable.feedback).toEqual([
        expect.objectContaining({ rule: content }),
      ]);
    }
  });

  for (const [index, testCase] of CASES.entries()) {
    it(`${testCase.locale} does not persist a one-off imperative`, async () => {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: `one-off-directive-${index}` };

      for (const content of [
        testCase.oneOff,
        ...testCase.adversarialOneOff,
      ]) {
        const result = await memory.remember({
          locale: testCase.locale,
          messages: [{ content, role: "user" }],
          scope,
        });
        expect(result.accepted).toBe(0);
      }
      const exported = await memory.exportMemory({ scope });

      expect(exported.durable.profile).toBeNull();
      expect(exported.durable.preferences).toEqual([]);
      expect(exported.durable.references).toEqual([]);
      if (testCase.locale === "en-US") {
        expect(exported.durable.references).toHaveLength(0);
      }
      expect(exported.durable.facts).toEqual([]);
      expect(exported.durable.feedback).toEqual([]);
      expect(exported.durable.episodes).toEqual([]);
      expect(exported.durable.archives).toEqual([]);
      expect(exported.durable.evidence).toEqual([]);
      expect(exported.durable.proposals).toEqual([]);
      expect(exported.durable.promotions).toEqual([]);
    });

    it(`${testCase.locale} persists an explicitly durable behavioral rule`, async () => {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: `durable-directive-${index}` };

      const result = await memory.remember({
        locale: testCase.locale,
        messages: [{ content: testCase.durable, role: "user" }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });

      expect(result.accepted).toBe(1);
      expect(exported.durable.feedback).toEqual([
        expect.objectContaining({ rule: testCase.durable }),
      ]);
    });
  }

  it("does not let a custom extractor reopen adversarial one-off directives", async () => {
    for (const [caseIndex, testCase] of CASES.entries()) {
      for (const [messageIndex, content] of testCase.adversarialOneOff.entries()) {
        const producerInputs: string[] = [];
        const memory = createGoodMemory({
          storage: { provider: "memory" },
          testing: {
            extractor: {
              async extract(input) {
                producerInputs.push(input.messages[0]?.content ?? "");
                return {
                  candidates: [{
                    content: "fabricated durable fact",
                    explicitness: "explicit",
                    id: "fabricated-one-off",
                    kindHint: "fact",
                    metadata: { category: "project" },
                    sourceMessageIndex: 0,
                    sourceRole: "user",
                  }],
                  ignoredMessageCount: 0,
                };
              },
            },
          },
        });
        const scope = {
          userId: `custom-one-off-${caseIndex}-${messageIndex}`,
        };

        const result = await memory.remember({
          locale: testCase.locale,
          messages: [{ content, role: "user" }],
          scope,
        });
        const exported = await memory.exportMemory({ scope });

        expect(producerInputs).toEqual([""]);
        expect(result.accepted).toBe(0);
        expect(exported.durable.facts).toEqual([]);
        expect(exported.durable.feedback).toEqual([]);
      }
    }
  });

  it("keeps confirmed remember-always authority above one-off admission", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = { userId: "one-off-directive-authority" };
    const content = CASES[0].oneOff;

    const result = await memory.remember({
      annotations: [{
        confirmed: true,
        kindHint: "fact",
        messageIndex: 0,
        remember: "always",
      }],
      locale: "en-US",
      messages: [{ content, role: "user" }],
      scope,
    });
    const exported = await memory.exportMemory({ scope });

    expect(result.accepted).toBe(1);
    expect(exported.durable.facts).toEqual([
      expect.objectContaining({ content }),
    ]);
  });

  it("keeps public feedback() as an explicit durable authority", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = { userId: "explicit-feedback-authority" };
    const signal = "Please use the read tool to read hello.txt.";

    const result = await memory.feedback({ scope, signal });
    const exported = await memory.exportMemory({ scope });

    expect(result.accepted).toBe(true);
    expect(exported.durable.feedback).toEqual([
      expect.objectContaining({ rule: signal }),
    ]);
  });

  it("does not persist standing-cue assertions as feedback", async () => {
    for (const [index, { locale, text }] of [
      {
        locale: "en-US",
        text: "From now on, use cases are documented in ADRs.",
      },
      { locale: "zh-CN", text: "以后使用率保持在80%。" },
      { locale: "zh-TW", text: "以後使用率保持在80%。" },
      {
        locale: "fr-FR",
        text: "Désormais, lire améliore la compréhension.",
      },
      {
        locale: "es-ES",
        text: "A partir de ahora, Lee es el responsable.",
      },
      { locale: "ja-JP", text: "今後はサーバーが安定しています。" },
      { locale: "ko-KR", text: "앞으로 서버는 안정적입니다." },
    ].entries()) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: `standing-assertion-${index}` };

      await memory.remember({
        locale,
        messages: [{ content: text, role: "user" }],
        scope,
      });

      expect((await memory.exportMemory({ scope })).durable.feedback).toEqual(
        [],
      );
    }
  });
});
