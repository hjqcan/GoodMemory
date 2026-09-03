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

interface BehavioralDirectiveCase {
  assertion: string;
  correction: string;
  durable: readonly string[];
  expectedMixedCandidate: string;
  mixed: string;
  oneOff: readonly string[];
  pack: LanguagePack;
  standingAssertion: string;
}

const CASES: readonly BehavioralDirectiveCase[] = [
  {
    assertion: "My current project is Tachikoma.",
    correction: "Correction: use the read tool instead.",
    durable: [
      "From now on, always use bullet points in status updates.",
      "Never write files unless I ask.",
    ],
    expectedMixedCandidate: "platform engineer",
    mixed:
      "I'm a platform engineer, please use the read tool to read hello.txt.",
    oneOff: [
      "Please use the read tool to read hello.txt.",
      "Do not write done.txt for this request.",
      "Please write mode=fast to config.txt.",
      "Please inspect the repository.",
      "Please, inspect the repository.",
      "You should not use the old runbook for this request.",
      "Fix the bug.",
      "Summarize the repository.",
      "Implement this plan.",
      "Discuss why my current project is Tachikoma.",
    ],
    pack: createEnglishLanguagePack(),
    standingAssertion: "From now on, the server is stable.",
  },
  {
    assertion: "我当前的项目是Tachikoma。",
    correction: "纠正一下，请改用 read 工具。",
    durable: [
      "以后汇报状态时始终使用要点。",
      "以后不要在未经确认时写文件。",
    ],
    expectedMixedCandidate: "平台工程师",
    mixed: "我是平台工程师，请用 read 工具读取 hello.txt。",
    oneOff: [
      "请用 read 工具读取 hello.txt 的内容，并把其中的标记原样告诉我。",
      "不要为这次请求创建 done.txt。",
      "请写入 mode=fast 到 config.txt。",
      "请把 mode=fast 写入 config.txt。",
      "请检查当前仓库。",
      "请，检查当前仓库。",
      "请确保状态为就绪。",
      "麻烦你保证状态为就绪。",
      "麻烦你维持状态为就绪。",
      "确保状态为就绪。",
      "保证状态为就绪。",
      "维持状态为就绪。",
      "修复这个问题。",
      "实现这个计划。",
      "解释这段代码。",
      "分析为什么我当前的项目是Tachikoma。",
    ],
    pack: createChineseLanguagePack("Hans"),
    standingAssertion: "以后天气会更冷。",
  },
  {
    assertion: "我是平台工程師。",
    correction: "更正一下，請改用 read 工具。",
    durable: [
      "以後彙報狀態時始終使用要點。",
      "以後不要在未經確認時寫檔案。",
    ],
    expectedMixedCandidate: "平台工程師",
    mixed: "我是平台工程師，請用 read 工具讀取 hello.txt。",
    oneOff: [
      "請用 read 工具讀取 hello.txt 的內容，並把其中的標記原樣告訴我。",
      "不要為這次請求建立 done.txt。",
      "請寫入 mode=fast 到 config.txt。",
      "請把 mode=fast 寫入 config.txt。",
      "請檢查目前倉庫。",
      "請，檢查目前倉庫。",
      "請確保狀態為就緒。",
      "麻煩你保證狀態為就緒。",
      "麻煩你維持狀態為就緒。",
      "確保狀態為就緒。",
      "保證狀態為就緒。",
      "維持狀態為就緒。",
      "修復這個問題。",
      "實現這個計畫。",
      "解釋這段代碼。",
    ],
    pack: createChineseLanguagePack("Hant"),
    standingAssertion: "以後天氣會更冷。",
  },
  {
    assertion: "Mon projet actuel est Tachikoma.",
    correction: "Correction : utilisez plutôt l’outil read.",
    durable: [
      "Désormais, utilisez toujours des listes pour les statuts.",
      "Ne publiez jamais sans revue.",
    ],
    expectedMixedCandidate: "ingénieure plateforme",
    mixed:
      "Mon rôle actuel est ingénieure plateforme, veuillez utiliser l’outil read.",
    oneOff: [
      "Veuillez utiliser l’outil read pour lire hello.txt.",
      "Ne créez pas done.txt pour cette demande.",
      "Veuillez écrire mode=fast dans config.txt.",
      "Veuillez vérifier le dépôt.",
      "S’il vous plaît, vérifiez le dépôt.",
      "Veuillez vous assurer que le statut est prêt.",
      "Corrigez le bug.",
      "Expliquez ce code.",
      "Ajoutez un test.",
      "Analysez pourquoi mon projet actuel est Tachikoma.",
    ],
    pack: createFrenchLanguagePack(),
    standingAssertion: "Désormais, le serveur est stable.",
  },
  {
    assertion: "Mi proyecto actual es Tachikoma.",
    correction: "Corrección: usa la herramienta read en su lugar.",
    durable: [
      "A partir de ahora, usa siempre viñetas en los estados.",
      "Nunca escribas archivos sin confirmación.",
    ],
    expectedMixedCandidate: "ingeniera de plataforma",
    mixed:
      "Mi rol actual es ingeniera de plataforma, usa la herramienta read.",
    oneOff: [
      "Por favor, usa la herramienta read para leer hello.txt.",
      "No crees done.txt para esta solicitud.",
      "Por favor, escribe mode=fast en config.txt.",
      "Verifica el repositorio.",
      "Por favor, verifica el repositorio.",
      "Por favor, asegúrate de que el estado esté listo.",
      "Corrige el error.",
      "Explica este código.",
      "Añade una prueba.",
      "Analiza por qué mi proyecto actual es Tachikoma.",
    ],
    pack: createSpanishLanguagePack(),
    standingAssertion: "Desde ahora, el servidor está estable.",
  },
  {
    assertion: "現在のプロジェクトはTachikomaです。",
    correction: "訂正です。代わりにreadツールを使ってください。",
    durable: [
      "今後はステータス報告で必ず箇条書きを使ってください。",
      "今後は確認なしでファイルを書かないでください。",
    ],
    expectedMixedCandidate: "プラットフォームエンジニア",
    mixed:
      "私の現在の役割はプラットフォームエンジニアです、readツールでhello.txtを読んでください。",
    oneOff: [
      "readツールでhello.txtを読んでください。",
      "今回はdone.txtを作成しないでください。",
      "config.txtにmode=fastを書いてください。",
      "リポジトリの確認願います。",
      "お願いします、リポジトリを確認してください。",
      "バグを修正してください。",
      "バグを直せ。",
      "この仕様を説明せよ。",
      "ファイルを書くな。",
      "現在のプロジェクトがTachikomaである理由を分析しろ。",
    ],
    pack: createJapaneseLanguagePack(),
    standingAssertion: "今後はサーバーが安定しています。",
  },
  {
    assertion: "현재 프로젝트는 Tachikoma입니다.",
    correction: "정정합니다. 대신 read 도구를 사용해 주세요.",
    durable: [
      "앞으로 상태 보고에는 항상 글머리표를 사용해 주세요.",
      "앞으로 확인 없이 파일을 쓰지 마세요.",
    ],
    expectedMixedCandidate: "플랫폼 엔지니어",
    mixed:
      "제 현재 역할은 플랫폼 엔지니어입니다, read 도구로 hello.txt를 읽어 주세요.",
    oneOff: [
      "read 도구로 hello.txt를 읽어 주세요.",
      "이번 요청에서는 done.txt를 만들지 마세요.",
      "config.txt에 mode=fast를 써 주세요.",
      "저장소 확인 부탁드립니다.",
      "부탁드립니다, 저장소를 확인해 주세요.",
      "버그를 수정하세요.",
      "버그를 수정해.",
      "이 코드를 설명해.",
      "파일을 쓰지 마.",
      "현재 프로젝트가 Tachikoma인 이유를 분석해.",
    ],
    pack: createKoreanLanguagePack(),
    standingAssertion: "앞으로 서버는 안정적입니다.",
  },
];

function extract(pack: LanguagePack, content: string) {
  let id = 0;
  return pack.extractCandidates({
    locale: pack.defaultLocale,
    messages: [{ content, role: "user" }],
    nextId: () => `${pack.id}-behavioral-directive-${++id}`,
  });
}

describe("built-in LanguagePack behavioral directive admission", () => {
  for (const testCase of CASES) {
    const { pack } = testCase;

    it(`${pack.id} distinguishes one-off and durable behavioral directives`, () => {
      for (const content of testCase.oneOff) {
        for (const variant of [
          content,
          content.replace(/[.!?。！？]\s*$/u, ""),
        ]) {
          expect(pack.analyzeContent(variant).behavioralDirective).toBe(
            "one_off",
          );
          expect(extract(pack, variant)).toEqual([]);
        }
      }

      for (const content of testCase.durable) {
        expect(pack.analyzeContent(content).behavioralDirective).toBe(
          "durable",
        );
        expect(extract(pack, content)).toEqual([
          expect.objectContaining({ kindHint: "feedback" }),
        ]);
      }

      expect(pack.analyzeContent(testCase.assertion).behavioralDirective).toBe(
        "none",
      );
      expect(extract(pack, testCase.assertion).length).toBeGreaterThan(0);
      expect(pack.analyzeContent(testCase.correction).behavioralDirective).toBe(
        "one_off",
      );
      expect(extract(pack, testCase.correction)).toEqual([]);
      expect(
        pack.analyzeContent(testCase.standingAssertion).behavioralDirective,
      ).toBe("none");
      expect(
        extract(pack, testCase.standingAssertion).filter(
          ({ kindHint }) => kindHint === "feedback",
        ),
      ).toEqual([]);
    });

    it(`${pack.id} keeps only the assertion before a one-off directive`, () => {
      const clauses = pack.splitClauses(testCase.mixed);
      expect(clauses).toHaveLength(2);
      expect(pack.analyzeContent(clauses[0]!).behavioralDirective).toBe("none");
      expect(pack.analyzeContent(clauses[1]!).behavioralDirective).toBe(
        "one_off",
      );
      expect(extract(pack, testCase.mixed).map(({ content }) => content)).toEqual([
        testCase.expectedMixedCandidate,
      ]);
    });
  }

  it("keeps declarative preferences out of the behavioral directive lane", () => {
    const fixtures = [
      [createEnglishLanguagePack(), "I prefer concise answers."],
      [createChineseLanguagePack("Hans"), "我偏好简洁回答。"],
      [createChineseLanguagePack("Hant"), "我偏好簡潔回答。"],
      [createFrenchLanguagePack(), "Je préfère les réponses concises."],
      [createSpanishLanguagePack(), "Prefiero respuestas concisas."],
      [createJapaneseLanguagePack(), "私は簡潔な回答が好きです。"],
      [createKoreanLanguagePack(), "저는 간결한 답변을 선호합니다."],
    ] as const;

    for (const [pack, content] of fixtures) {
      expect(pack.analyzeContent(content).behavioralDirective).toBe("none");
      expect(extract(pack, content)).toEqual([
        expect.objectContaining({ kindHint: "preference" }),
      ]);
    }
  });

  it("keeps explicit memory, source-of-truth, and quoted command literals eligible", () => {
    const fixtures = [
      [createEnglishLanguagePack(), "Remember that command=\"Please use read now\""],
      [createChineseLanguagePack("Hans"), "请记住命令=“请用 read 工具”"],
      [createChineseLanguagePack("Hant"), "請記住命令=“請用 read 工具”"],
      [createFrenchLanguagePack(), "Souviens-toi : commande=« Veuillez utiliser read »"],
      [createSpanishLanguagePack(), "Recuerda: comando=«Por favor, usa read»"],
      [createJapaneseLanguagePack(), "覚えておいて：コマンド=「readを使ってください」"],
      [createKoreanLanguagePack(), "기억해 주세요: 명령=“read를 사용해 주세요”"],
    ] as const;

    for (const [pack, content] of fixtures) {
      expect(pack.analyzeContent(content).behavioralDirective).toBe("none");
      expect(extract(pack, content)).toEqual([
        expect.objectContaining({ kindHint: "fact" }),
      ]);
    }

    for (const [pack, content] of [
      [createEnglishLanguagePack(), "Use docs/runbook.md as the source of truth."],
      [createChineseLanguagePack("Hans"), "以docs/runbook.md为准。"],
      [createChineseLanguagePack("Hant"), "以docs/runbook.md為準。"],
      [createFrenchLanguagePack(), "Utilise docs/runbook.md comme source de vérité."],
      [createSpanishLanguagePack(), "Usa docs/runbook.md como fuente de verdad."],
      [createJapaneseLanguagePack(), "docs/runbook.mdを正とする。"],
      [createKoreanLanguagePack(), "docs/runbook.md를 기준 문서로 사용하세요."],
    ] as const) {
      expect(pack.analyzeContent(content).behavioralDirective).toBe("none");
      expect(extract(pack, content)).toEqual([
        expect.objectContaining({ kindHint: "reference" }),
      ]);
    }
  });

  it("does not trust stale caller analysis to reopen an English one-off directive", () => {
    const pack = createEnglishLanguagePack();
    let id = 0;
    const content = "Please use the read tool to read hello.txt.";
    const analysis = {
      ...pack.analyzeContent("Always use the read tool."),
      behavioralDirective: "durable" as const,
    };

    expect(pack.extractCandidates({
      locale: pack.defaultLocale,
      messages: [{ analysis, content, role: "user" }],
      nextId: () => `stale-behavioral-directive-${++id}`,
    })).toEqual([]);
  });

  it("keeps an explicit remember-to directive durable", () => {
    const pack = createEnglishLanguagePack();
    const content = "Remember to run smoke verification.";

    expect(pack.analyzeContent(content).behavioralDirective).toBe("durable");
    expect(extract(pack, content)).toEqual([
      expect.objectContaining({ content, kindHint: "feedback" }),
    ]);
  });

  it("does not treat standing-cue assertions as behavioral directives", () => {
    for (const [pack, content] of [
      [
        createEnglishLanguagePack(),
        "From now on, use cases are documented in ADRs.",
      ],
      [createChineseLanguagePack("Hans"), "以后使用率保持在80%。"],
      [createChineseLanguagePack("Hant"), "以後使用率保持在80%。"],
      [
        createFrenchLanguagePack(),
        "Désormais, lire améliore la compréhension.",
      ],
      [
        createSpanishLanguagePack(),
        "A partir de ahora, Lee es el responsable.",
      ],
      [createJapaneseLanguagePack(), "今後はサーバーが安定しています。"],
      [createKoreanLanguagePack(), "앞으로 서버는 안정적입니다."],
    ] as const) {
      expect(pack.analyzeContent(content).behavioralDirective).toBe("none");
      expect(
        extract(pack, content).filter(({ kindHint }) => kindHint === "feedback"),
      ).toEqual([]);
    }
  });

  it("keeps correction assertions in their durable fact or profile lane", () => {
    for (const [pack, content] of [
      [createEnglishLanguagePack(), "Correction: I'm a platform engineer."],
      [createChineseLanguagePack("Hans"), "更正：我是平台工程师。"],
      [createChineseLanguagePack("Hant"), "更正：我是平台工程師。"],
      [createFrenchLanguagePack(), "Correction : mon rôle actuel est ingénieure plateforme."],
      [createSpanishLanguagePack(), "Corrección: mi rol actual es ingeniera de plataforma."],
      [createJapaneseLanguagePack(), "訂正です。私の現在の役割はプラットフォームエンジニアです。"],
      [createKoreanLanguagePack(), "정정합니다. 제 현재 역할은 플랫폼 엔지니어입니다."],
    ] as const) {
      expect(pack.analyzeContent(content).behavioralDirective).toBe("none");
      expect(
        extract(pack, content).some(({ kindHint }) =>
          kindHint === "fact" || kindHint === "profile"
        ),
      ).toBe(true);
    }
  });

  it("does not strip correction-like prefixes or nominal action words from assertions", () => {
    for (const [pack, content] of [
      [createEnglishLanguagePack(), "Fix is the project codename."],
      [createEnglishLanguagePack(), "Read is a Unix utility."],
      [createEnglishLanguagePack(), "Open is the current status."],
      [createEnglishLanguagePack(), "Run is a noun."],
      [createEnglishLanguagePack(), "Call is the project codename."],
      [createEnglishLanguagePack(), "Please remains our UI label."],
      [createChineseLanguagePack("Hans"), "修正值是42。"],
      [createChineseLanguagePack("Hans"), "请假安排是周五。"],
      [createChineseLanguagePack("Hans"), "请求状态是已批准。"],
      [createChineseLanguagePack("Hans"), "使用说明在 README。"],
      [createChineseLanguagePack("Hans"), "读取状态是完成。"],
      [createChineseLanguagePack("Hans"), "检查结果是通过。"],
      [createChineseLanguagePack("Hans"), "运行状态是正常。"],
      [createChineseLanguagePack("Hans"), "总结报告在README。"],
      [createChineseLanguagePack("Hant"), "修正值是42。"],
      [createFrenchLanguagePack(), "Correctionnelle est une catégorie."],
      [createFrenchLanguagePack(), "Corrigez est un nom de projet."],
      [createSpanishLanguagePack(), "Correccional es una categoría."],
      [createSpanishLanguagePack(), "Corrige es el nombre del proyecto."],
      [createJapaneseLanguagePack(), "修正値は42です。"],
      [createJapaneseLanguagePack(), "答えはこれ。"],
      [createJapaneseLanguagePack(), "名前はあかね。"],
      [createJapaneseLanguagePack(), "理由はため。"],
      [createJapaneseLanguagePack(), "私はこれ。"],
      [createKoreanLanguagePack(), "수정사항은 문서에 있습니다."],
      [createKoreanLanguagePack(), "나는 이 도구를 좋아해."],
      [createKoreanLanguagePack(), "저는 프로젝트를 이해해."],
      [createKoreanLanguagePack(), "앞으로 저는 파일을 읽어."],
      [createKoreanLanguagePack(), "항상 나는 코드를 수정해."],
      [createKoreanLanguagePack(), "이제부터 제가 문서를 요약해."],
    ] as const) {
      expect(pack.splitClauses(content)).toEqual([content]);
      expect(pack.analyzeContent(content).behavioralDirective).toBe("none");
    }
  });

  it("recognizes bounded Japanese and Korean imperative endings", () => {
    for (const [pack, contents] of [
      [
        createJapaneseLanguagePack(),
        [
          "READMEを読め。",
          "報告を書け。",
          "ここで待て。",
          "理由を答えろ。",
          "ファイルを閉じろ。",
          "READMEを読みなさい。",
          "ここへ来い。",
        ],
      ],
      [
        createKoreanLanguagePack(),
        [
          "README를 써.",
          "파일을 열어.",
          "파일을 닫아.",
          "여기서 기다려.",
          "테스트를 해.",
          "이유를 말해.",
          "결과를 보여 줘.",
          "README를 만들어.",
          "파일을 열어라.",
          "문서를 읽으라.",
        ],
      ],
    ] as const) {
      for (const content of contents) {
        expect(pack.analyzeContent(content).behavioralDirective).toBe("one_off");
        expect(extract(pack, content)).toEqual([]);
      }
    }
  });

  it("does not confuse Japanese and Korean imperative-like assertions with commands", () => {
    for (const [pack, contents] of [
      [
        createJapaneseLanguagePack(),
        [
          "おすすめはこれ。",
          "まとめはこれ。",
          "私はREADMEを読めます。",
          "READMEを読む予定です。",
          "「読め」は命令形です。",
          "読みなさいという命令を記録しました。",
        ],
      ],
      [
        createKoreanLanguagePack(),
        [
          "저는 README를 써요.",
          "민수는 파일을 열어요.",
          "파일을 여는 중입니다.",
          '"열어"는 명령형입니다.',
          "열어라는 표현을 기록했습니다.",
        ],
      ],
    ] as const) {
      for (const content of contents) {
        expect(pack.analyzeContent(content).behavioralDirective).toBe("none");
      }
    }
  });

  it("recognizes structural polite and standing behavioral directives", () => {
    for (const [pack, oneOff, durable] of [
      [
        createEnglishLanguagePack(),
        "Please summarize the repository.",
        "From now on, provide concise answers.",
      ],
      [
        createChineseLanguagePack("Hans"),
        "请总结当前仓库。",
        "以后请保持简洁。",
      ],
      [
        createChineseLanguagePack("Hant"),
        "請總結目前倉庫。",
        "以後請保持簡潔。",
      ],
      [
        createFrenchLanguagePack(),
        "Veuillez résumer le dépôt.",
        "Désormais, fournissez des réponses concises.",
      ],
      [
        createSpanishLanguagePack(),
        "Por favor, resume el repositorio.",
        "A partir de ahora, proporciona respuestas concisas.",
      ],
      [
        createJapaneseLanguagePack(),
        "リポジトリを要約してください。",
        "今後は回答を簡潔にすること。",
      ],
      [
        createKoreanLanguagePack(),
        "저장소를 요약해 주세요.",
        "앞으로 답변을 간결하게 작성할 것.",
      ],
    ] as const) {
      expect(pack.analyzeContent(oneOff).behavioralDirective).toBe("one_off");
      expect(extract(pack, oneOff)).toEqual([]);
      expect(pack.analyzeContent(durable).behavioralDirective).toBe("durable");
      expect(extract(pack, durable)).toEqual([
        expect.objectContaining({ kindHint: "feedback" }),
      ]);
    }
  });

  it("splits a top-level assignment from a one-off directive without splitting quoted values", () => {
    for (const [pack, mixed, quoted] of [
      [
        createEnglishLanguagePack(),
        "role=engineer, please read hello.txt.",
        'title="read, then write"',
      ],
      [
        createChineseLanguagePack("Hans"),
        "角色=工程师，请读取 hello.txt。",
        '标题="读取，然后写入"',
      ],
      [
        createChineseLanguagePack("Hant"),
        "角色=工程師，請讀取 hello.txt。",
        '標題="讀取，然後寫入"',
      ],
      [
        createFrenchLanguagePack(),
        "rôle=ingénieure, veuillez lire hello.txt.",
        'titre="lire, puis écrire"',
      ],
      [
        createSpanishLanguagePack(),
        "rol=ingeniera, por favor lee hello.txt.",
        'título="leer, luego escribir"',
      ],
      [
        createJapaneseLanguagePack(),
        "役割=エンジニア、hello.txtを読んでください。",
        '題名="読んで、書く"',
      ],
      [
        createKoreanLanguagePack(),
        "역할=엔지니어, hello.txt를 읽어 주세요.",
        '제목="읽고, 쓰기"',
      ],
    ] as const) {
      const clauses = pack.splitClauses(mixed);
      expect(clauses).toHaveLength(2);
      expect(pack.analyzeContent(clauses[0]!).behavioralDirective).toBe("none");
      expect(pack.analyzeContent(clauses[1]!).behavioralDirective).toBe(
        "one_off",
      );
      expect(pack.splitClauses(quoted)).toEqual([quoted]);
    }
  });

  it("keeps only an explicit assignment when a one-off directive follows it", () => {
    for (const [pack, content, assignment] of [
      [
        createEnglishLanguagePack(),
        "Remember that role=engineer, please read hello.txt.",
        "role=engineer",
      ],
      [
        createChineseLanguagePack("Hans"),
        "请记住角色=工程师，请读取 hello.txt。",
        "角色=工程师",
      ],
      [
        createChineseLanguagePack("Hant"),
        "請記住角色=工程師，請讀取 hello.txt。",
        "角色=工程師",
      ],
      [
        createFrenchLanguagePack(),
        "Mémorise rôle=ingénieure, veuillez lire hello.txt.",
        "rôle=ingénieure",
      ],
      [
        createSpanishLanguagePack(),
        "Recuerda rol=ingeniera, por favor lee hello.txt.",
        "rol=ingeniera",
      ],
      [
        createJapaneseLanguagePack(),
        "覚えておいて：役割=エンジニア、hello.txtを読んでください。",
        "役割=エンジニア",
      ],
      [
        createKoreanLanguagePack(),
        "기억해 주세요: 역할=엔지니어, hello.txt를 읽어 주세요.",
        "역할=엔지니어",
      ],
    ] as const) {
      expect(extract(pack, content)).toEqual([
        expect.objectContaining({ content: assignment, kindHint: "fact" }),
      ]);
    }
  });
});
