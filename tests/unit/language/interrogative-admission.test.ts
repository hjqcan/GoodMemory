import { describe, expect, it } from "bun:test";

import {
  createChineseLanguagePack,
  createEnglishLanguagePack,
  createFrenchLanguagePack,
  createJapaneseLanguagePack,
  createKoreanLanguagePack,
  createSpanishLanguagePack,
} from "../../../src/language";
import type { LanguagePack } from "../../../src/language/contracts";

interface InterrogativeCase {
  assertion: string;
  confirmationQuestion: string;
  expectedMixedCandidate: string;
  mixed: string;
  mixedUnpunctuated: string;
  pack: LanguagePack;
  questions: readonly string[];
  retrievalNoise: readonly string[];
  retrievalProbe: string;
  retrievalSignal: string;
}

const CASES: readonly InterrogativeCase[] = [
  {
    assertion: "My preferred language is English.",
    confirmationQuestion: "My current role is engineer, right",
    expectedMixedCandidate: "platform engineer",
    mixed: "I'm an engineer, what should I do next?",
    mixedUnpunctuated: "I am a platform engineer, what should I do next",
    pack: createEnglishLanguagePack(),
    questions: [
      "My preferred language is what?",
      "My preferred language is what",
      "I ate what",
      "I yesterday ate what",
      "Is my preferred language English",
    ],
    retrievalNoise: ["what", "why", "whose", "whom"],
    retrievalProbe: "Whose role, whom should I ask, what failed and why?",
    retrievalSignal: "failed",
  },
  {
    assertion: "我正在做Tachikoma。",
    confirmationQuestion: "我的当前角色是工程师，对吧",
    expectedMixedCandidate: "平台工程师",
    mixed: "我正在做Tachikoma，下一步做什么？",
    mixedUnpunctuated: "我是平台工程师，下一步做什么",
    pack: createChineseLanguagePack("Hans"),
    questions: [
      "你能帮我做什么？",
      "我昨天吃了什么",
      "我的项目代号是Tachikoma吗",
    ],
    retrievalNoise: ["为什么", "为什", "什么", "吗", "哪位", "如何", "何处"],
    retrievalProbe: "哪位知道如何处理何处的项目，为什么失败吗？",
    retrievalSignal: "项目",
  },
  {
    assertion: "我正在做Tachikoma。",
    confirmationQuestion: "我的當前角色是工程師，對吧",
    expectedMixedCandidate: "平台工程師",
    mixed: "我正在做Tachikoma，下一步做什麼？",
    mixedUnpunctuated: "我是平台工程師，下一步做什麼",
    pack: createChineseLanguagePack("Hant"),
    questions: [
      "你能幫我做什麼？",
      "我昨天吃了什麼",
      "我的項目代號是Tachikoma嗎",
    ],
    retrievalNoise: ["為什麼", "為什", "什麼", "嗎", "哪位", "如何", "何處"],
    retrievalProbe: "哪位知道如何處理何處的專案，為什麼失敗嗎？",
    retrievalSignal: "專案",
  },
  {
    assertion: "Mon rôle actuel est ingénieur.",
    confirmationQuestion: "Mon rôle actuel est ingénieur, n’est-ce pas",
    expectedMixedCandidate: "ingénieure plateforme",
    mixed: "Mon rôle actuel est ingénieur, quelle est la prochaine étape ?",
    mixedUnpunctuated:
      "Mon rôle actuel est ingénieure plateforme, que dois-je faire ensuite",
    pack: createFrenchLanguagePack(),
    questions: [
      "Mon rôle actuel est quoi ?",
      "Mon rôle actuel est quoi",
      "Est-ce que mon rôle actuel est ingénieur",
    ],
    retrievalNoise: [
      "quoi",
      "quelle",
      "pourquoi",
      "qu",
      "lequel",
      "laquelle",
      "lesquels",
      "lesquelles",
    ],
    retrievalProbe:
      "Lequel, laquelle, lesquels ou lesquelles explique qu’est-ce qui a bloqué cette étape ?",
    retrievalSignal: "étape",
  },
  {
    assertion: "Mi rol actual es ingeniero.",
    confirmationQuestion: "Mi rol actual es ingeniero, verdad",
    expectedMixedCandidate: "ingeniera de plataforma",
    mixed: "Mi rol actual es ingeniero, ¿cuál es el siguiente paso?",
    mixedUnpunctuated:
      "Mi rol actual es ingeniera de plataforma, qué debo hacer después",
    pack: createSpanishLanguagePack(),
    questions: [
      "Mi rol actual es cuál?",
      "Mi rol actual es cuál",
      "¿Mi rol actual es ingeniero",
    ],
    retrievalNoise: ["cuál", "qué", "por qué", "adónde", "cuán"],
    retrievalProbe: "¿Adónde cambió y cuán grave fue el bloqueo?",
    retrievalSignal: "cambió",
  },
  {
    assertion: "私の現在の役割はエンジニアです。",
    confirmationQuestion: "私の現在の役割はエンジニアですよね",
    expectedMixedCandidate: "プラットフォームエンジニア",
    mixed: "私の現在の役割はエンジニアです、次に何をしますか？",
    mixedUnpunctuated:
      "私の現在の役割はプラットフォームエンジニアです、次に何をすべきですか",
    pack: createJapaneseLanguagePack(),
    questions: [
      "私の現在の役割は何ですか？",
      "私の現在の役割は何ですか",
      "私の現在の役割はエンジニアですか",
    ],
    retrievalNoise: ["何", "なぜ", "どちら", "どなた", "いう"],
    retrievalProbe:
      "何がなぜ変わり、どちらをどなたにどういう手順で確認しますか？",
    retrievalSignal: "変わり",
  },
  {
    assertion: "제 현재 역할은 플랫폼 엔지니어입니다.",
    confirmationQuestion: "제 현재 역할은 엔지니어죠",
    expectedMixedCandidate: "플랫폼 엔지니어",
    mixed: "제 현재 역할은 플랫폼 엔지니어입니다, 다음에는 무엇을 해야 합니까?",
    mixedUnpunctuated:
      "제 현재 역할은 플랫폼 엔지니어입니다, 다음에는 무엇을 해야 합니까",
    pack: createKoreanLanguagePack(),
    questions: [
      "제 현재 역할은 무엇입니까?",
      "제 현재 역할은 무엇입니까",
      "제 현재 역할은 플랫폼 엔지니어입니까",
    ],
    retrievalNoise: [
      "무엇",
      "무엇을",
      "뭐를",
      "누구를",
      "어디를",
      "왜",
      "어떻게",
      "누가",
      "무슨",
    ],
    retrievalProbe:
      "무엇을 뭐를 누구를 어디를 누가 무슨 프로젝트를 왜 어떻게 바꿔야 합니까?",
    retrievalSignal: "바꿔야",
  },
];

function extract(pack: LanguagePack, content: string) {
  let id = 0;
  return pack.extractCandidates({
    locale: pack.defaultLocale,
    messages: [{ content, role: "user" }],
    nextId: () => `${pack.id}-interrogative-${++id}`,
  });
}

describe("built-in LanguagePack interrogative admission", () => {
  for (const testCase of CASES) {
    const { pack } = testCase;

    it(`${pack.id} marks punctuated and unpunctuated questions and emits no candidates`, () => {
      for (const question of testCase.questions) {
        expect(pack.analyzeContent(question).interrogative).toBe(true);
        expect(extract(pack, question)).toEqual([]);
      }
      expect(pack.analyzeContent(testCase.assertion).interrogative).toBe(false);
      expect(extract(pack, testCase.assertion).length).toBeGreaterThan(0);
    });

    it(`${pack.id} rejects an unpunctuated confirmation question`, () => {
      expect(
        pack.analyzeContent(testCase.confirmationQuestion).interrogative,
      ).toBe(true);
      expect(extract(pack, testCase.confirmationQuestion)).toEqual([]);
    });

    it(`${pack.id} keeps the assertion before a trailing question`, () => {
      const clauses = pack.splitClauses(testCase.mixed);
      expect(clauses).toHaveLength(2);
      expect(pack.analyzeContent(clauses[0]!).interrogative).toBe(false);
      expect(pack.analyzeContent(clauses[1]!).interrogative).toBe(true);

      const candidates = extract(pack, testCase.mixed);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.content).not.toMatch(/[?？]$/u);
    });

    it(`${pack.id} splits an unpunctuated trailing question from its assertion`, () => {
      const clauses = pack.splitClauses(testCase.mixedUnpunctuated);
      expect(clauses).toHaveLength(2);
      expect(pack.analyzeContent(clauses[0]!).interrogative).toBe(false);
      expect(pack.analyzeContent(clauses[1]!).interrogative).toBe(true);

      expect(
        extract(pack, testCase.mixedUnpunctuated).map(
          (candidate) => candidate.content,
        ),
      ).toEqual([testCase.expectedMixedCandidate]);
    });

    it(`${pack.id} removes interrogative anchors only from retrieval terms`, () => {
      const raw = pack.tokenizeForScoring(testCase.retrievalProbe, "bm25");
      const filtered = pack.tokenizeForScoring(
        testCase.retrievalProbe,
        "bm25",
        { excludeStopwords: true },
      );
      const searchTerms = pack.buildSearchTerms(testCase.retrievalProbe);

      expect(raw.some((token) => testCase.retrievalNoise.includes(token))).toBe(
        true,
      );
      for (const noise of testCase.retrievalNoise) {
        expect(filtered).not.toContain(noise);
        expect(searchTerms).not.toContain(noise);
      }
      expect(filtered).toContain(testCase.retrievalSignal);
      expect(searchTerms).toContain(testCase.retrievalSignal);
    });
  }

  it("keeps quoted question literals inside explicit assignments", () => {
    const fixtures = [
      [createEnglishLanguagePack(), 'Remember that FAQ title="Why, exactly?"'],
      [createChineseLanguagePack("Hans"), "请记住FAQ标题=“为什么，现在失败？”"],
      [createChineseLanguagePack("Hant"), "請記住FAQ標題=“為什麼，現在失敗？”"],
      [
        createFrenchLanguagePack(),
        "Souviens-toi : titre FAQ=« Pourquoi, maintenant ? »",
      ],
      [createSpanishLanguagePack(), "Recuerda: título FAQ=«¿Por qué, ahora?»"],
      [
        createJapaneseLanguagePack(),
        "覚えておいて：FAQタイトル=「なぜ、今失敗する？」",
      ],
      [
        createKoreanLanguagePack(),
        "기억해 주세요: FAQ 제목=“왜, 지금 실패하나요?”",
      ],
    ] as const;

    for (const [pack, content] of fixtures) {
      expect(pack.splitClauses(content)).toEqual([content]);
      expect(extract(pack, content)).toEqual([
        expect.objectContaining({ kindHint: "fact" }),
      ]);
    }
  });

  it("does not split declarative relative-clause tails as questions", () => {
    const fixtures = [
      [
        createEnglishLanguagePack(),
        "My commute takes 45 minutes, which makes planning important.",
      ],
      [
        createFrenchLanguagePack(),
        "Mon projet est Atlas, qui reste bloqué par la validation.",
      ],
      [
        createSpanishLanguagePack(),
        "Mi proyecto es Atlas, que sigue bloqueado por la validación.",
      ],
    ] as const;

    for (const [pack, content] of fixtures) {
      expect(pack.splitClauses(content)).toEqual([content]);
      expect(pack.analyzeContent(content).interrogative).toBe(false);
    }
  });

  it("keeps leading wh subordinate clauses inside English assertions", () => {
    const pack = createEnglishLanguagePack();
    const content = "When I am working, I prefer concise answers.";

    expect(pack.splitClauses(content)).toEqual([content]);
    expect(pack.analyzeContent(content).interrogative).toBe(false);
    expect(
      extract(pack, content).map((candidate) => candidate.kindHint),
    ).toContain("preference");
  });

  it("keeps leading French quand subordinate clauses inside assertions", () => {
    const pack = createFrenchLanguagePack();
    const content = "Quand je travaille, je préfère des réponses concises.";

    expect(pack.splitClauses(content)).toEqual([content]);
    expect(pack.analyzeContent(content).interrogative).toBe(false);
    expect(
      extract(pack, content).map((candidate) => candidate.kindHint),
    ).toContain("preference");
  });

  it("keeps leading interrogative nominal clauses as assertions", () => {
    const fixtures = [
      [
        createEnglishLanguagePack(),
        "What matters is reliability",
        "What matters",
      ],
      [
        createEnglishLanguagePack(),
        "Who owns the service is documented",
        "Who owns the service",
      ],
      [
        createEnglishLanguagePack(),
        "What causes failures is documented",
        "What causes failures",
      ],
      [
        createChineseLanguagePack("Hans"),
        "如何部署由团队决定",
        "如何由团队决定部署方式",
      ],
      [
        createChineseLanguagePack("Hans"),
        "谁负责这个项目已记录在文档中",
        "谁负责这个项目",
      ],
      [
        createChineseLanguagePack("Hant"),
        "如何部署由團隊決定",
        "如何由團隊決定部署方式",
      ],
      [
        createChineseLanguagePack("Hant"),
        "誰負責這個專案已記錄在文件中",
        "誰負責這個專案",
      ],
      [
        createFrenchLanguagePack(),
        "Comment le système fonctionne dépend de la configuration",
        "Comment le système dépend de la configuration",
      ],
      [
        createFrenchLanguagePack(),
        "Pourquoi cela fonctionne est expliqué ici",
        "Pourquoi cela fonctionne",
      ],
      [
        createSpanishLanguagePack(),
        "Cómo funciona el sistema depende de la configuración",
        "Cómo depende el sistema de la configuración",
      ],
      [
        createSpanishLanguagePack(),
        "Quién dirige el proyecto está documentado",
        "Quién dirige el proyecto",
      ],
      [
        createJapaneseLanguagePack(),
        "何を使うかはチームが決めました",
        "何を使いますか",
      ],
      [
        createKoreanLanguagePack(),
        "누가 담당하는지는 문서에 기록되어 있습니다",
        "누가 담당합니까",
      ],
    ] as const;

    for (const [pack, content, question] of fixtures) {
      expect(pack.splitClauses(content)).toEqual([content]);
      expect(pack.analyzeContent(content).interrogative).toBe(false);
      expect(pack.analyzeContent(question).interrogative).toBe(true);
      expect(extract(pack, question)).toEqual([]);
    }

    for (const [pack, question] of [
      [createChineseLanguagePack("Hans"), "谁已记录在文档中"],
      [createChineseLanguagePack("Hant"), "誰已記錄在文件中"],
    ] as const) {
      expect(pack.analyzeContent(question).interrogative).toBe(true);
      expect(extract(pack, question)).toEqual([]);
    }

    const english = createEnglishLanguagePack();
    const embeddedSubject = "What I ate yesterday was pasta.";
    expect(english.splitClauses(embeddedSubject)).toEqual([embeddedSubject]);
    expect(english.analyzeContent(embeddedSubject).interrogative).toBe(false);
  });

  it("does not let nominal-clause exceptions hide direct questions", () => {
    const fixtures = [
      [createEnglishLanguagePack(), "What I ate depends on what"],
      [createChineseLanguagePack("Hans"), "如何部署由谁决定"],
      [createChineseLanguagePack("Hant"), "如何部署由誰決定"],
      [
        createFrenchLanguagePack(),
        "Comment le système fonctionne dépend de quoi",
      ],
      [
        createSpanishLanguagePack(),
        "Cómo funciona el sistema depende de qué",
      ],
    ] as const;

    for (const [pack, question] of fixtures) {
      expect(pack.analyzeContent(question).interrogative).toBe(true);
      expect(extract(pack, question)).toEqual([]);
    }
  });

  it("keeps unresolved wh-nominal assertions out of the question lane", () => {
    const fixtures = [
      [createEnglishLanguagePack(), "How the system works remains unclear"],
      [createChineseLanguagePack("Hans"), "谁负责这个项目尚不清楚"],
      [createChineseLanguagePack("Hant"), "誰負責這個專案尚不清楚"],
      [createFrenchLanguagePack(), "Qui dirige le projet demeure inconnu"],
      [
        createSpanishLanguagePack(),
        "Quién dirige el proyecto sigue sin estar claro",
      ],
      [createJapaneseLanguagePack(), "誰が担当するかは不明です"],
      [createKoreanLanguagePack(), "누가 담당하는지는 불분명합니다"],
    ] as const;

    for (const [pack, assertion] of fixtures) {
      expect(pack.analyzeContent(assertion).interrogative).toBe(false);
    }
  });

  it("fails closed on unmatched quotes without breaking word apostrophes", () => {
    const fixtures = [
      [createEnglishLanguagePack(), '"What is my role?'],
      [createEnglishLanguagePack(), "James' role is what?"],
      [createChineseLanguagePack("Hans"), "“我正在做什么？"],
      [createChineseLanguagePack("Hant"), "「我正在做什麼？"],
      [createFrenchLanguagePack(), "« Pourquoi cela fonctionne ?"],
      [createSpanishLanguagePack(), "« Qué hace el sistema ?"],
      [createJapaneseLanguagePack(), "「現在の役割は何ですか？"],
      [createKoreanLanguagePack(), "“현재 역할은 무엇입니까?"],
    ] as const;

    for (const [pack, question] of fixtures) {
      expect(pack.analyzeContent(question).interrogative).toBe(true);
      expect(extract(pack, question)).toEqual([]);
    }
  });

  it("does not let stale caller analysis override English admission", () => {
    const pack = createEnglishLanguagePack();
    let id = 0;
    const analysis = {
      ...pack.analyzeContent("My preferred language is English."),
      interrogative: false,
    };

    expect(
      pack.extractCandidates({
        locale: "en-US",
        messages: [
          {
            analysis,
            content: "My preferred language is what?",
            role: "user",
          },
        ],
        nextId: () => `stale-analysis-${++id}`,
      }),
    ).toEqual([]);
  });

  it("rejects source-of-truth statements phrased as confirmation questions", () => {
    const fixtures = [
      [
        createEnglishLanguagePack(),
        "Use docs/runbook.md as the source of truth, right",
      ],
      [
        createChineseLanguagePack("Hans"),
        "把docs/runbook.md作为当前事实来源，对吧",
      ],
      [
        createChineseLanguagePack("Hant"),
        "把docs/runbook.md作為當前事實來源，對吧",
      ],
      [
        createFrenchLanguagePack(),
        "Utilise docs/runbook.md comme source de vérité, n’est-ce pas",
      ],
      [
        createSpanishLanguagePack(),
        "Usa docs/runbook.md como fuente de verdad, verdad",
      ],
      [
        createJapaneseLanguagePack(),
        "docs/runbook.mdを現在の正本として使いますよね",
      ],
      [
        createKoreanLanguagePack(),
        "docs/runbook.md를 현재 기준 문서로 사용하죠",
      ],
    ] as const;

    for (const [pack, content] of fixtures) {
      expect(pack.analyzeContent(content).interrogative).toBe(true);
      expect(extract(pack, content)).toEqual([]);
    }
  });
});
