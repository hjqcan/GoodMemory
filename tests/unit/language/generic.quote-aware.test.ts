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
});
