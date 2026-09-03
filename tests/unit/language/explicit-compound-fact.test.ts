import { describe, expect, it } from "bun:test";

import { createDeterministicMemoryExtractor } from "../../../src/remember/deterministicExtractor";

const CASES = [
  {
    expected: ["my editor is Neovim", "project code is Nightjar"],
    locale: "en-US",
    source: "Remember that my editor is Neovim, project code is Nightjar",
  },
  {
    expected: ["我的编辑器是 Neovim", "项目代号是 Nightjar"],
    locale: "zh-CN",
    source: "请记住：我的编辑器是 Neovim，项目代号是 Nightjar。",
  },
  {
    expected: ["我的編輯器是 Neovim", "專案代號是 Nightjar"],
    locale: "zh-TW",
    source: "請記住：我的編輯器是 Neovim，專案代號是 Nightjar。",
  },
  {
    expected: ["mon éditeur est Neovim", "le code projet est Nightjar"],
    locale: "fr-FR",
    source: "Souviens-toi : mon éditeur est Neovim, le code projet est Nightjar",
  },
  {
    expected: ["mi editor es Neovim", "el código de proyecto es Nightjar"],
    locale: "es-ES",
    source: "Recuerda: mi editor es Neovim, el código de proyecto es Nightjar",
  },
  {
    expected: ["私のエディタはNeovim", "プロジェクトコードはNightjar"],
    locale: "ja-JP",
    source: "覚えておいて：私のエディタはNeovim、プロジェクトコードはNightjar。",
  },
  {
    expected: ["제 편집기는 Neovim", "프로젝트 코드는 Nightjar"],
    locale: "ko-KR",
    source: "기억해 주세요: 제 편집기는 Neovim, 프로젝트 코드는 Nightjar입니다",
  },
] as const;

const SINGLE_FACT_CASES = [
  ["en-US", "Remember that my location is Portland, Oregon"],
  ["zh-CN", "请记住：我的位置是中国，北京。"],
  ["zh-TW", "請記住：我的位置是中國，台北。"],
  ["fr-FR", "Souviens-toi : ma localisation est Paris, France"],
  ["es-ES", "Recuerda: mi ubicación es Madrid, España"],
  ["ja-JP", "覚えておいて：私の勤務地は東京、日本。"],
  ["ko-KR", "기억해 주세요: 제 위치는 서울, 대한민국"],
] as const;

const STRUCTURED_VALUE_CASES = [
  ["en-US", "Remember that config={editor=Neovim, project=Nightjar}"],
  ["zh-CN", "请记住：配置={编辑器=Neovim，项目=Nightjar}。"],
  ["zh-TW", "請記住：設定={編輯器=Neovim，專案=Nightjar}。"],
  ["fr-FR", "Souviens-toi : config={éditeur=Neovim, projet=Nightjar}"],
  ["es-ES", "Recuerda: config={editor=Neovim, proyecto=Nightjar}"],
  ["ja-JP", "覚えておいて：設定={エディタ=Neovim、プロジェクト=Nightjar}。"],
  ["ko-KR", "기억해 주세요: 설정={편집기=Neovim, 프로젝트=Nightjar}"],
] as const;

const ONE_OFF_TAIL_CASES = [
  [
    "en-US",
    "Remember that editor=Neovim, please tell me what is in hello.txt",
    "editor=Neovim",
  ],
  [
    "zh-CN",
    "请记住：编辑器=Neovim，请告诉我 hello.txt 里是什么。",
    "编辑器=Neovim",
  ],
  [
    "zh-TW",
    "請記住：編輯器=Neovim，請告訴我 hello.txt 裡是什麼。",
    "編輯器=Neovim",
  ],
  [
    "fr-FR",
    "Souviens-toi : éditeur=Neovim, veuillez me dire ce qui est dans hello.txt",
    "éditeur=Neovim",
  ],
  [
    "es-ES",
    "Recuerda: editor=Neovim, por favor dime qué es lo que hay en hello.txt",
    "editor=Neovim",
  ],
  [
    "ja-JP",
    "覚えておいて：エディタ=Neovim、hello.txtの内容が何か教えてください。",
    "エディタ=Neovim",
  ],
  [
    "ko-KR",
    "기억해 주세요: 편집기=Neovim, hello.txt에 무엇이 있는지 알려 주세요.",
    "편집기=Neovim",
  ],
] as const;

const DEPENDENT_TAIL_CASES = [
  [
    "en-US",
    "Remember that my status is ready, although it is not final",
    "my status is ready, although it is not final",
  ],
  [
    "zh-CN",
    "请记住：状态是就绪，虽然它是临时的。",
    "状态是就绪，虽然它是临时的",
  ],
  [
    "zh-TW",
    "請記住：狀態是就緒，雖然它是臨時的。",
    "狀態是就緒，雖然它是臨時的",
  ],
  [
    "fr-FR",
    "Souviens-toi : mon statut est prêt, bien qu'il soit provisoire",
    "mon statut est prêt, bien qu'il soit provisoire",
  ],
  [
    "es-ES",
    "Recuerda: mi estado es listo, aunque es provisional",
    "mi estado es listo, aunque es provisional",
  ],
  [
    "ja-JP",
    "覚えておいて：状態は準備完了、ただしこれは暫定です。",
    "状態は準備完了、ただしこれは暫定です",
  ],
  [
    "ko-KR",
    "기억해 주세요: 상태는 준비됨, 비록 이것은 임시입니다.",
    "상태는 준비됨, 비록 이것은 임시입니다",
  ],
] as const;

const COUNTED_MIXED_CASES = [
  {
    expectedOne: ["editor=Neovim"],
    expectedTwo: ["editor=Neovim", "project code=Nightjar"],
    locale: "en-US",
    one: "Remember one thing: editor=Neovim, please tell me what is in hello.txt",
    two:
      "Remember two things: editor=Neovim, project code=Nightjar, what should I do next?",
  },
  {
    expectedOne: ["编辑器=Neovim"],
    expectedTwo: ["编辑器=Neovim", "项目代号=Nightjar"],
    locale: "zh-CN",
    one: "请记住一件事：编辑器=Neovim，请告诉我 hello.txt 里是什么。",
    two: "请记住两件事：编辑器=Neovim，项目代号=Nightjar，下一步做什么？",
  },
  {
    expectedOne: ["編輯器=Neovim"],
    expectedTwo: ["編輯器=Neovim", "專案代號=Nightjar"],
    locale: "zh-TW",
    one: "請記住一件事：編輯器=Neovim，請告訴我 hello.txt 裡是什麼。",
    two: "請記住兩件事：編輯器=Neovim，專案代號=Nightjar，下一步做什麼？",
  },
  {
    expectedOne: ["éditeur=Neovim"],
    expectedTwo: ["éditeur=Neovim", "code projet=Nightjar"],
    locale: "fr-FR",
    one:
      "Souviens-toi d'une chose : éditeur=Neovim, veuillez me dire ce qui est dans hello.txt",
    two:
      "Souviens-toi de deux choses : éditeur=Neovim, code projet=Nightjar, que dois-je faire ensuite ?",
  },
  {
    expectedOne: ["editor=Neovim"],
    expectedTwo: ["editor=Neovim", "código de proyecto=Nightjar"],
    locale: "es-ES",
    one:
      "Recuerda una cosa: editor=Neovim, por favor dime qué es lo que hay en hello.txt",
    two:
      "Recuerda dos cosas: editor=Neovim, código de proyecto=Nightjar, ¿qué debo hacer después?",
  },
  {
    expectedOne: ["エディタ=Neovim"],
    expectedTwo: ["エディタ=Neovim", "プロジェクトコード=Nightjar"],
    locale: "ja-JP",
    one:
      "一つのことを覚えておいて：エディタ=Neovim、hello.txtの内容が何か教えてください。",
    two:
      "二つのことを覚えておいて：エディタ=Neovim、プロジェクトコード=Nightjar、次に何をすればいいですか？",
  },
  {
    expectedOne: ["편집기=Neovim"],
    expectedTwo: ["편집기=Neovim", "프로젝트 코드=Nightjar"],
    locale: "ko-KR",
    one:
      "한 가지를 기억해 주세요: 편집기=Neovim, hello.txt에 무엇이 있는지 알려 주세요.",
    two:
      "두 가지를 기억해 주세요: 편집기=Neovim, 프로젝트 코드=Nightjar, 다음에 무엇을 해야 하나요?",
  },
] as const;

const QUALIFIED_MULTI_FACT_CASES = [
  {
    counted:
      "Remember two things: editor=Neovim, deployment is safe, although only in staging",
    expected: ["editor=Neovim", "deployment is safe, although only in staging"],
    locale: "en-US",
    uncounted:
      "Remember that editor=Neovim, deployment is safe, although only in staging",
  },
  {
    counted: "请记住两件事：编辑器=Neovim，部署是安全的，虽然仅限暂存环境。",
    expected: ["编辑器=Neovim", "部署是安全的，虽然仅限暂存环境"],
    locale: "zh-CN",
    uncounted: "请记住：编辑器=Neovim，部署是安全的，虽然仅限暂存环境。",
  },
  {
    counted: "請記住兩件事：編輯器=Neovim，部署是安全的，雖然僅限暫存環境。",
    expected: ["編輯器=Neovim", "部署是安全的，雖然僅限暫存環境"],
    locale: "zh-TW",
    uncounted: "請記住：編輯器=Neovim，部署是安全的，雖然僅限暫存環境。",
  },
  {
    counted:
      "Souviens-toi de deux choses : éditeur=Neovim, le déploiement est sûr, bien qu'il soit limité à la préproduction",
    expected: [
      "éditeur=Neovim",
      "le déploiement est sûr, bien qu'il soit limité à la préproduction",
    ],
    locale: "fr-FR",
    uncounted:
      "Souviens-toi : éditeur=Neovim, le déploiement est sûr, bien qu'il soit limité à la préproduction",
  },
  {
    counted:
      "Recuerda dos cosas: editor=Neovim, el despliegue es seguro, aunque solo en preproducción",
    expected: [
      "editor=Neovim",
      "el despliegue es seguro, aunque solo en preproducción",
    ],
    locale: "es-ES",
    uncounted:
      "Recuerda: editor=Neovim, el despliegue es seguro, aunque solo en preproducción",
  },
  {
    counted:
      "二つのことを覚えておいて：エディタ=Neovim、デプロイは安全、ただしステージング限定です。",
    expected: ["エディタ=Neovim", "デプロイは安全、ただしステージング限定です"],
    locale: "ja-JP",
    uncounted:
      "覚えておいて：エディタ=Neovim、デプロイは安全、ただしステージング限定です。",
  },
  {
    counted:
      "두 가지를 기억해 주세요: 편집기=Neovim, 배포는 안전함, 비록 스테이징에서만 가능함.",
    expected: ["편집기=Neovim", "배포는 안전함, 비록 스테이징에서만 가능함"],
    locale: "ko-KR",
    uncounted:
      "기억해 주세요: 편집기=Neovim, 배포는 안전함, 비록 스테이징에서만 가능함.",
  },
] as const;

describe("explicit compound facts", () => {
  for (const [index, testCase] of CASES.entries()) {
    it(`${testCase.locale} splits independent assertions at an unquoted comma`, async () => {
      const extractor = createDeterministicMemoryExtractor();
      const result = await extractor.extract({
        locale: testCase.locale,
        messages: [{ content: testCase.source, role: "user" }],
        scope: {
          sessionId: `explicit-compound-${index}`,
          userId: `explicit-compound-${index}`,
        },
      });

      expect(result.candidates.map(({ content }) => content)).toEqual(
        [...testCase.expected],
      );
      expect(result.candidates.every(({ kindHint }) => kindHint === "fact"))
        .toBeTrue();
    });
  }

  it("does not split a comma inside an explicit quoted value", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const result = await extractor.extract({
      locale: "zh-CN",
      messages: [{
        content: "请记住：发布标签是“Nightjar，稳定版”。",
        role: "user",
      }],
      scope: { sessionId: "quoted-comma", userId: "quoted-comma" },
    });

    expect(result.candidates.map(({ content }) => content)).toEqual([
      "发布标签是“Nightjar，稳定版”",
    ]);
  });

  for (const [index, [locale, source]] of SINGLE_FACT_CASES.entries()) {
    it(`${locale} keeps a comma inside one assertion value`, async () => {
      const extractor = createDeterministicMemoryExtractor();
      const result = await extractor.extract({
        locale,
        messages: [{ content: source, role: "user" }],
        scope: {
          sessionId: `compound-value-${index}`,
          userId: `compound-value-${index}`,
        },
      });

      expect(result.candidates).toHaveLength(1);
    });
  }

  for (const [index, [locale, source]] of STRUCTURED_VALUE_CASES.entries()) {
    it(`${locale} keeps nested structured values intact`, async () => {
      const extractor = createDeterministicMemoryExtractor();
      const result = await extractor.extract({
        locale,
        messages: [{ content: source, role: "user" }],
        scope: {
          sessionId: `compound-structured-${index}`,
          userId: `compound-structured-${index}`,
        },
      });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.content).toContain("{");
      expect(result.candidates[0]?.content).toContain("}");
    });
  }

  for (const [index, [locale, source, expected]] of ONE_OFF_TAIL_CASES.entries()) {
    it(`${locale} excludes a one-off tail from an explicit fact`, async () => {
      const extractor = createDeterministicMemoryExtractor();
      const result = await extractor.extract({
        locale,
        messages: [{ content: source, role: "user" }],
        scope: {
          sessionId: `compound-one-off-${index}`,
          userId: `compound-one-off-${index}`,
        },
      });

      expect(result.candidates.map(({ content }) => content)).toEqual([
        expected,
      ]);
    });
  }

  for (const [index, [locale, source, expected]] of DEPENDENT_TAIL_CASES.entries()) {
    it(`${locale} keeps a dependent qualifier attached to its fact`, async () => {
      const extractor = createDeterministicMemoryExtractor();
      const result = await extractor.extract({
        locale,
        messages: [{ content: source, role: "user" }],
        scope: {
          sessionId: `compound-dependent-${index}`,
          userId: `compound-dependent-${index}`,
        },
      });

      expect(result.candidates.map(({ content }) => content)).toEqual([
        expected,
      ]);
    });
  }

  for (const [index, testCase] of COUNTED_MIXED_CASES.entries()) {
    it(`${testCase.locale} applies a declared count after excluding ordinary tails`, async () => {
      const extractor = createDeterministicMemoryExtractor();
      const scope = {
        sessionId: `compound-counted-mixed-${index}`,
        userId: `compound-counted-mixed-${index}`,
      };
      const one = await extractor.extract({
        locale: testCase.locale,
        messages: [{ content: testCase.one, role: "user" }],
        scope,
      });
      const two = await extractor.extract({
        locale: testCase.locale,
        messages: [{ content: testCase.two, role: "user" }],
        scope,
      });

      expect(one.candidates.map(({ content }) => content)).toEqual(
        [...testCase.expectedOne],
      );
      expect(two.candidates.map(({ content }) => content)).toEqual(
        [...testCase.expectedTwo],
      );
    });
  }

  for (const [index, testCase] of QUALIFIED_MULTI_FACT_CASES.entries()) {
    it(`${testCase.locale} attaches a dependent qualifier to the preceding fact`, async () => {
      const extractor = createDeterministicMemoryExtractor();
      for (const [sourceIndex, content] of [
        testCase.uncounted,
        testCase.counted,
      ].entries()) {
        const result = await extractor.extract({
          locale: testCase.locale,
          messages: [{ content, role: "user" }],
          scope: {
            sessionId: `compound-qualified-${index}-${sourceIndex}`,
            userId: `compound-qualified-${index}-${sourceIndex}`,
          },
        });

        expect(result.candidates.map(({ content: fact }) => fact)).toEqual(
          [...testCase.expected],
        );
      }
    });
  }

  it("does not use nested structure fragments to satisfy an explicit count", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const one = await extractor.extract({
      locale: "en-US",
      messages: [{
        content: "Remember one thing: config={editor=Neovim, project=Nightjar}",
        role: "user",
      }],
      scope: { sessionId: "structured-count-one", userId: "structured-count-one" },
    });
    const two = await extractor.extract({
      locale: "en-US",
      messages: [{
        content: "Remember two things: config={editor=Neovim, project=Nightjar}",
        role: "user",
      }],
      scope: { sessionId: "structured-count-two", userId: "structured-count-two" },
    });

    expect(one.candidates.map(({ content }) => content)).toEqual([
      "config={editor=Neovim, project=Nightjar}",
    ]);
    expect(two.candidates).toEqual([]);
  });

  it("keeps Chinese action homographs in nominal assertions", async () => {
    const extractor = createDeterministicMemoryExtractor();
    const result = await extractor.extract({
      locale: "zh-CN",
      messages: [{
        content: "请记住：维持时间为三天，质保状态为有效。",
        role: "user",
      }],
      scope: {
        sessionId: "compound-chinese-action-homograph",
        userId: "compound-chinese-action-homograph",
      },
    });

    expect(result.candidates.map(({ content }) => content)).toEqual([
      "维持时间为三天",
      "质保状态为有效",
    ]);
  });

  for (const [index, testCase] of ([
    {
      insufficient:
        "请记住两件事：编辑器=Neovim，请把状态设置为就绪。",
      invalidFirst:
        "请记住两件事：请把状态设置为就绪，编辑器=Neovim，项目代号=Nightjar。",
      locale: "zh-CN",
      mixed: [
        "请记住：编辑器=Neovim，请把状态设置为就绪。",
        "请记住：编辑器=Neovim，请告诉我答案是 Nightjar。",
      ],
    },
    {
      insufficient:
        "請記住兩件事：編輯器=Neovim，請把狀態設定為就緒。",
      invalidFirst:
        "請記住兩件事：請把狀態設定為就緒，編輯器=Neovim，專案代號=Nightjar。",
      locale: "zh-TW",
      mixed: [
        "請記住：編輯器=Neovim，請把狀態設定為就緒。",
        "請記住：編輯器=Neovim，請告訴我答案是 Nightjar。",
      ],
    },
  ] as const).entries()) {
    it(`${testCase.locale} never treats a clear one-off command as a copula fact`, async () => {
      const extractor = createDeterministicMemoryExtractor();
      for (const [sourceIndex, content] of testCase.mixed.entries()) {
        const result = await extractor.extract({
          locale: testCase.locale,
          messages: [{ content, role: "user" }],
          scope: {
            sessionId: `compound-chinese-command-${index}-${sourceIndex}`,
            userId: `compound-chinese-command-${index}-${sourceIndex}`,
          },
        });

        expect(result.candidates.map(({ content: fact }) => fact)).toEqual([
          testCase.locale === "zh-CN" ? "编辑器=Neovim" : "編輯器=Neovim",
        ]);
      }

      for (const [sourceIndex, content] of [
        testCase.invalidFirst,
        testCase.insufficient,
      ].entries()) {
        const result = await extractor.extract({
          locale: testCase.locale,
          messages: [{ content, role: "user" }],
          scope: {
            sessionId: `compound-chinese-invalid-${index}-${sourceIndex}`,
            userId: `compound-chinese-invalid-${index}-${sourceIndex}`,
          },
        });

        expect(result.candidates).toEqual([]);
      }
    });
  }

  for (const [index, testCase] of ([
    {
      bareInvalidFirst:
        "请记住两件事：确保状态为就绪，编辑器=Neovim，项目代号=Nightjar。",
      bareMixed: "请记住：编辑器=Neovim，确保状态为就绪。",
      expected: "编辑器=Neovim",
      invalidFirst:
        "请记住两件事：请确保状态为就绪，编辑器=Neovim，项目代号=Nightjar。",
      locale: "zh-CN",
      mixed: "请记住：编辑器=Neovim，请确保状态为就绪。",
    },
    {
      bareInvalidFirst:
        "請記住兩件事：確保狀態為就緒，編輯器=Neovim，專案代號=Nightjar。",
      bareMixed: "請記住：編輯器=Neovim，確保狀態為就緒。",
      expected: "編輯器=Neovim",
      invalidFirst:
        "請記住兩件事：請確保狀態為就緒，編輯器=Neovim，專案代號=Nightjar。",
      locale: "zh-TW",
      mixed: "請記住：編輯器=Neovim，請確保狀態為就緒。",
    },
    {
      bareInvalidFirst: undefined,
      bareMixed: undefined,
      expected: "éditeur=Neovim",
      invalidFirst:
        "Souviens-toi de deux choses : veuillez vous assurer que le statut est prêt, éditeur=Neovim, code projet=Nightjar",
      locale: "fr-FR",
      mixed:
        "Souviens-toi : éditeur=Neovim, veuillez vous assurer que le statut est prêt",
    },
    {
      bareInvalidFirst: undefined,
      bareMixed: undefined,
      expected: "editor=Neovim",
      invalidFirst:
        "Recuerda dos cosas: por favor asegúrate de que el estado esté listo, editor=Neovim, código de proyecto=Nightjar",
      locale: "es-ES",
      mixed:
        "Recuerda: editor=Neovim, por favor asegúrate de que el estado esté listo",
    },
  ] as const).entries()) {
    it(`${testCase.locale} excludes an ensure request from explicit facts`, async () => {
      const extractor = createDeterministicMemoryExtractor();
      const mixed = await extractor.extract({
        locale: testCase.locale,
        messages: [{ content: testCase.mixed, role: "user" }],
        scope: {
          sessionId: `compound-ensure-mixed-${index}`,
          userId: `compound-ensure-mixed-${index}`,
        },
      });
      const invalidFirst = await extractor.extract({
        locale: testCase.locale,
        messages: [{ content: testCase.invalidFirst, role: "user" }],
        scope: {
          sessionId: `compound-ensure-invalid-${index}`,
          userId: `compound-ensure-invalid-${index}`,
        },
      });

      expect(mixed.candidates.map(({ content }) => content)).toEqual([
        testCase.expected,
      ]);
      expect(invalidFirst.candidates).toEqual([]);

      if (testCase.bareMixed && testCase.bareInvalidFirst) {
        const bareMixed = await extractor.extract({
          locale: testCase.locale,
          messages: [{ content: testCase.bareMixed, role: "user" }],
          scope: {
            sessionId: `compound-ensure-bare-mixed-${index}`,
            userId: `compound-ensure-bare-mixed-${index}`,
          },
        });
        const bareInvalidFirst = await extractor.extract({
          locale: testCase.locale,
          messages: [{ content: testCase.bareInvalidFirst, role: "user" }],
          scope: {
            sessionId: `compound-ensure-bare-invalid-${index}`,
            userId: `compound-ensure-bare-invalid-${index}`,
          },
        });

        expect(bareMixed.candidates.map(({ content }) => content)).toEqual([
          testCase.expected,
        ]);
        expect(bareInvalidFirst.candidates).toEqual([]);
      }
    });
  }

});

