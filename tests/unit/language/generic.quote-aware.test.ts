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

interface QuotedAssignmentFixture {
  content: string;
  expectedFact: string;
  pack: LanguagePack;
}

interface ReportedOptOutFixture {
  directOptOut: string;
  expectedFact: string;
  pack: LanguagePack;
  quotedLiteral: string;
  reported: string;
}

const FIXTURES: readonly QuotedAssignmentFixture[] = [
  {
    content: 'Remember that FAQ title="Why? Really？ Done。 Yes!"',
    expectedFact: 'FAQ title="Why? Really？ Done。 Yes!"',
    pack: createEnglishLanguagePack(),
  },
  {
    content: "请记住FAQ标题=“为什么? 真的吗？完成。继续!”",
    expectedFact: "FAQ标题=“为什么? 真的吗？完成。继续!”",
    pack: createChineseLanguagePack("Hans"),
  },
  {
    content: "請記住FAQ標題=“為什麼? 真的嗎？完成。繼續!”",
    expectedFact: "FAQ標題=“為什麼? 真的嗎？完成。繼續!”",
    pack: createChineseLanguagePack("Hant"),
  },
  {
    content: "Souviens-toi : titre FAQ=« Pourquoi? Vraiment？ Fini。 Oui! »",
    expectedFact: "titre FAQ=« Pourquoi? Vraiment？ Fini。 Oui! »",
    pack: createFrenchLanguagePack(),
  },
  {
    content: "Recuerda: título FAQ=«¿Por qué? ¿De verdad？ Fin。 Sí!»",
    expectedFact: "título FAQ=«¿Por qué? ¿De verdad？ Fin。 Sí!»",
    pack: createSpanishLanguagePack(),
  },
  {
    content: "覚えておいて：FAQタイトル=「なぜ? 本当？完了。続行!」",
    expectedFact: "FAQタイトル=「なぜ? 本当？完了。続行!」",
    pack: createJapaneseLanguagePack(),
  },
  {
    content: "기억해 주세요: FAQ 제목=“왜? 정말？ 완료。 계속!”",
    expectedFact: "FAQ 제목=“왜? 정말？ 완료。 계속!”",
    pack: createKoreanLanguagePack(),
  },
];

const REPORTED_OPT_OUT_FIXTURES: readonly ReportedOptOutFixture[] = [
  {
    directOptOut: "Do not remember project code=Tachikoma",
    expectedFact: "project code=Tachikoma",
    pack: createEnglishLanguagePack(),
    quotedLiteral:
      'Remember that policy="do not remember project code=Tachikoma"',
    reported:
      "Remember that project code=Tachikoma; I did not say do not remember project code=Tachikoma",
  },
  {
    directOptOut: "不要记住项目代号=Tachikoma",
    expectedFact: "项目代号=Tachikoma",
    pack: createChineseLanguagePack("Hans"),
    quotedLiteral: '请记住策略="不要记住项目代号=Tachikoma"',
    reported:
      "请记住项目代号=Tachikoma；我没有说不要记住项目代号=Tachikoma",
  },
  {
    directOptOut: "不要記住專案代號=Tachikoma",
    expectedFact: "專案代號=Tachikoma",
    pack: createChineseLanguagePack("Hant"),
    quotedLiteral: '請記住策略="不要記住專案代號=Tachikoma"',
    reported:
      "請記住專案代號=Tachikoma；我沒有說不要記住專案代號=Tachikoma",
  },
  {
    directOptOut: "Ne mémorise pas code projet=Tachikoma",
    expectedFact: "code projet=Tachikoma",
    pack: createFrenchLanguagePack(),
    quotedLiteral:
      'Souviens-toi : politique="ne mémorise pas code projet=Tachikoma"',
    reported:
      "Souviens-toi : code projet=Tachikoma; Je n’ai pas dit : ne mémorise pas code projet=Tachikoma",
  },
  {
    directOptOut: "No recuerdes código de proyecto=Tachikoma",
    expectedFact: "código de proyecto=Tachikoma",
    pack: createSpanishLanguagePack(),
    quotedLiteral:
      'Recuerda: política="no recuerdes código de proyecto=Tachikoma"',
    reported:
      "Recuerda: código de proyecto=Tachikoma; No dije: no recuerdes código de proyecto=Tachikoma",
  },
  {
    directOptOut: "プロジェクトコード=Tachikomaを覚えないでください",
    expectedFact: "プロジェクトコード=Tachikoma",
    pack: createJapaneseLanguagePack(),
    quotedLiteral:
      '覚えておいて：ポリシー="プロジェクトコード=Tachikomaを覚えないでください"',
    reported:
      "覚えておいて：プロジェクトコード=Tachikoma；私は言っていません、プロジェクトコード=Tachikomaを覚えないでください",
  },
  {
    directOptOut: "프로젝트 코드=Tachikoma를 기억하지 마세요",
    expectedFact: "프로젝트 코드=Tachikoma",
    pack: createKoreanLanguagePack(),
    quotedLiteral:
      '기억해 주세요: 정책="프로젝트 코드=Tachikoma를 기억하지 마세요"',
    reported:
      "기억해 주세요: 프로젝트 코드=Tachikoma; 저는 말하지 않았습니다, 프로젝트 코드=Tachikoma를 기억하지 마세요",
  },
];

function extract(pack: LanguagePack, content: string) {
  let nextId = 0;
  return pack.extractCandidates({
    locale: pack.defaultLocale,
    messages: [{ content, role: "user" }],
    nextId: () => `${pack.id}-scope-${++nextId}`,
  });
}

describe("quote-aware generic clause splitting", () => {
  it("keeps sentence punctuation inside seven-language quoted assignments", () => {
    for (const fixture of FIXTURES) {
      expect(fixture.pack.splitClauses(fixture.content)).toEqual([
        fixture.content,
      ]);

      let nextId = 0;
      const candidates = fixture.pack.extractCandidates({
        locale: fixture.pack.defaultLocale,
        messages: [{ content: fixture.content, role: "user" }],
        nextId: () => `${fixture.pack.id}-quoted-${++nextId}`,
      });

      expect(candidates).toEqual([
        expect.objectContaining({
          content: fixture.expectedFact,
          kindHint: "fact",
        }),
      ]);
    }
  });

  it("fails closed when an assignment question opens but never closes a quote", () => {
    const fixtures = [
      [createEnglishLanguagePack(), 'Remember that FAQ title="Tachikoma — why?'],
      [createChineseLanguagePack("Hans"), '请记住FAQ标题="Tachikoma——为什么？'],
      [createChineseLanguagePack("Hant"), '請記住FAQ標題="Tachikoma——為什麼？'],
      [createFrenchLanguagePack(), 'Souviens-toi : titre FAQ="Tachikoma — pourquoi ?'],
      [createSpanishLanguagePack(), 'Recuerda: título FAQ="Tachikoma — por qué?'],
      [createJapaneseLanguagePack(), '覚えておいて：FAQタイトル="Tachikoma — なぜ？'],
      [createKoreanLanguagePack(), '기억해 주세요: FAQ 제목="Tachikoma — 왜?'],
    ] as const;

    for (const [pack, content] of fixtures) {
      let nextId = 0;
      const candidates = pack.extractCandidates({
        locale: pack.defaultLocale,
        messages: [{ content, role: "user" }],
        nextId: () => `${pack.id}-unterminated-${++nextId}`,
      });

      expect(candidates.some(({ kindHint }) => kindHint === "fact")).toBe(false);
    }
  });

  it("does not split an e.g. value before the next counted assignment", () => {
    const pack = createEnglishLanguagePack();
    let nextId = 0;
    const candidates = pack.extractCandidates({
      locale: pack.defaultLocale,
      messages: [{
        content:
          "Remember two things: example=e.g. Use Neovim. shell=zsh",
        role: "user",
      }],
      nextId: () => `english-abbreviation-${++nextId}`,
    });

    expect(candidates.filter(({ kindHint }) => kindHint === "fact")).toEqual([
      expect.objectContaining({ content: "example=e.g. Use Neovim" }),
      expect.objectContaining({ content: "shell=zsh" }),
    ]);
  });

  it("keeps reported opt-out words outside directive scope", () => {
    for (const fixture of REPORTED_OPT_OUT_FIXTURES) {
      const candidates = extract(fixture.pack, fixture.reported);

      expect(candidates).toContainEqual(expect.objectContaining({
        content: fixture.expectedFact,
        kindHint: "fact",
      }));
      expect(candidates.some(({ kindHint }) => kindHint === "feedback")).toBe(
        false,
      );
    }
  });

  it("requires an English opt-out to begin its own direct clause", () => {
    for (const reported of [
      "I deny saying do not remember project code=Tachikoma",
      "The user disputes the instruction do not remember project code=Tachikoma",
      "I do not remember project code=Tachikoma",
      "I explicitly do not remember project code=Tachikoma",
      "I genuinely do not remember project code=Tachikoma",
      "The sentence do not remember project code=Tachikoma appears in the guide",
      "In the guide, do not remember project code=Tachikoma",
      "In the quoted sentence, do not remember project code=Tachikoma",
    ]) {
      const candidates = extract(
        createEnglishLanguagePack(),
        `Remember that project code=Tachikoma; ${reported}`,
      );

      expect(candidates).toContainEqual(expect.objectContaining({
        content: "project code=Tachikoma",
        kindHint: "fact",
      }));
      expect(candidates.some(({ kindHint }) => kindHint === "feedback")).toBe(
        false,
      );
    }
  });

  it("keeps semicolons inside English explicit quoted values", () => {
    for (const input of [
      'Remember that note="alpha; beta"',
      'Remember that question="what; exactly?"',
    ]) {
      const candidates = extract(createEnglishLanguagePack(), input);

      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({ kindHint: "fact" });
      expect(candidates[0]?.content).toContain(";");
    }
  });

  it("does not promote embedded multilingual opt-out text into a directive", () => {
    for (const [pack, content] of [
      [
        createChineseLanguagePack("Hans"),
        "请记住项目代号=Tachikoma；说明中出现不要记住项目代号=Tachikoma这句话",
      ],
      [
        createFrenchLanguagePack(),
        "Souviens-toi : code projet=Tachikoma; La phrase ne mémorise pas code projet=Tachikoma figure dans le guide",
      ],
      [
        createSpanishLanguagePack(),
        "Recuerda: código de proyecto=Tachikoma; La frase no recuerdes código de proyecto=Tachikoma aparece en la guía",
      ],
    ] as const) {
      const candidates = extract(pack, content);

      expect(candidates.some(({ kindHint }) => kindHint === "feedback")).toBe(
        false,
      );
    }
  });

  it("keeps direct English opt-outs active after non-clausal modifiers", () => {
    for (const direct of [
      "also do not remember project code=Tachikoma",
      "for GDPR Article 5, do not remember project code=Tachikoma",
      "for privacy do not remember project code=Tachikoma",
      "in this workspace do not remember project code=Tachikoma",
    ]) {
      const candidates = extract(createEnglishLanguagePack(), direct);

      expect(candidates.some(({ kindHint }) => kindHint === "feedback")).toBe(
        true,
      );
      expect(candidates.some(({ kindHint }) => kindHint === "fact")).toBe(
        false,
      );
    }
  });

  it("keeps multilingual opt-outs active after discourse, time, and legal modifiers", () => {
    for (const [pack, directives] of [
      [createEnglishLanguagePack(), [
        "Actually, do not remember project code=Tachikoma",
        "Now do not remember project code=Tachikoma",
        "From now on, do not remember project code=Tachikoma",
        "For legal reasons, do not remember project code=Tachikoma",
      ]],
      [createChineseLanguagePack("Hans"), [
        "其实，不要记住项目代号=Tachikoma",
        "现在不要记住项目代号=Tachikoma",
        "从现在起，不要记住项目代号=Tachikoma",
        "出于法律原因，不要记住项目代号=Tachikoma",
      ]],
      [createChineseLanguagePack("Hant"), [
        "其實，不要記住專案代號=Tachikoma",
        "現在不要記住專案代號=Tachikoma",
        "從現在起，不要記住專案代號=Tachikoma",
        "出於法律原因，不要記住專案代號=Tachikoma",
      ]],
      [createFrenchLanguagePack(), [
        "Finalement, ne mémorise pas code projet=Tachikoma",
        "Maintenant, ne mémorise pas code projet=Tachikoma",
        "Pour des raisons légales, ne mémorise pas code projet=Tachikoma",
      ]],
      [createSpanishLanguagePack(), [
        "En realidad, no recuerdes código de proyecto=Tachikoma",
        "Ahora no recuerdes código de proyecto=Tachikoma",
        "Por razones legales, no recuerdes código de proyecto=Tachikoma",
      ]],
    ] as const) {
      for (const directive of directives) {
        const candidates = extract(pack, directive);
        expect(candidates.some(({ kindHint }) => kindHint === "feedback")).toBe(
          true,
        );
        expect(candidates.some(({ kindHint }) => kindHint === "fact")).toBe(
          false,
        );
      }
    }
  });

  it("keeps direct opt-outs active and quoted opt-out literals inert", () => {
    for (const fixture of REPORTED_OPT_OUT_FIXTURES) {
      const direct = extract(fixture.pack, fixture.directOptOut);
      expect(direct.some(({ kindHint }) => kindHint === "feedback")).toBe(true);
      expect(direct.some(({ kindHint }) => kindHint === "fact")).toBe(false);

      const quoted = extract(fixture.pack, fixture.quotedLiteral);
      expect(quoted.some(({ kindHint }) => kindHint === "fact")).toBe(true);
      expect(quoted.some(({ kindHint }) => kindHint === "feedback")).toBe(false);
    }
  });
});
