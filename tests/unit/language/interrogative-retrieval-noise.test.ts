import { describe, expect, it } from "bun:test";

import { createGoodMemory } from "../../../src";
import {
  createChineseLanguagePack,
  createEnglishLanguagePack,
  createFrenchLanguagePack,
  createJapaneseLanguagePack,
  createKoreanLanguagePack,
  createSpanishLanguagePack,
} from "../../../src/language";
import type { LanguagePack } from "../../../src/language/contracts";

interface RecallNoiseCase {
  badFact: string;
  locale: string;
  query: string;
}

interface LegitimateLiteralCase {
  expectedToken: string;
  fact: string;
  label: string;
  locale: string;
  pack: LanguagePack;
  query: string;
}

const OMITTED_INTERROGATIVE_FORMS: readonly RecallNoiseCase[] = [
  {
    badFact: "How many meals did I eat?",
    locale: "en-US",
    query: "How many objects are in this image?",
  },
  {
    badFact: "WHAT did I eat?",
    locale: "en-US",
    query: "WHAT is in this image?",
  },
  {
    badFact: '"What did I eat?',
    locale: "en-US",
    query: '"What is in this image?',
  },
  {
    badFact: "何人负责后端。",
    locale: "zh-CN",
    query: "何人绘制图像？",
  },
  {
    badFact: "“我吃了什么？",
    locale: "zh-CN",
    query: "“这张图片画了什么？",
  },
  {
    badFact: "何人負責後端。",
    locale: "zh-TW",
    query: "何人繪製圖像？",
  },
  {
    badFact: "Qu’ai-je mangé ?",
    locale: "fr-FR",
    query: "Qu’a-t-il dessiné ?",
  },
  {
    badFact: "Donde comi.",
    locale: "es-ES",
    query: "Donde dibujaron?",
  },
  {
    badFact: "どんな食事ですか？",
    locale: "ja-JP",
    query: "どんな絵ですか？",
  },
  {
    badFact: "何人食べた？",
    locale: "ja-JP",
    query: "何人描いた？",
  },
  {
    badFact: "어찌 먹었나요?",
    locale: "ko-KR",
    query: "어찌 그렸나요?",
  },
];

const LEGITIMATE_LITERALS: readonly LegitimateLiteralCase[] = [
  {
    expectedToken: "where",
    fact: "The SQL keyword is `WHERE`.",
    label: "English all-caps code",
    locale: "en-US",
    pack: createEnglishLanguagePack(),
    query: "`WHERE`",
  },
  {
    expectedToken: "如何",
    fact: "产品代号是“如何”。",
    label: "Simplified Chinese quoted",
    locale: "zh-CN",
    pack: createChineseLanguagePack("Hans"),
    query: "“如何”",
  },
  {
    expectedToken: "如何",
    fact: "產品代號是「如何」。",
    label: "Traditional Chinese quoted",
    locale: "zh-TW",
    pack: createChineseLanguagePack("Hant"),
    query: "「如何」",
  },
  {
    expectedToken: "où",
    fact: "Le titre est « Où ».",
    label: "French quoted",
    locale: "fr-FR",
    pack: createFrenchLanguagePack(),
    query: "« Où »",
  },
  {
    expectedToken: "qué",
    fact: "El título es « Qué ».",
    label: "Spanish quoted",
    locale: "es-ES",
    pack: createSpanishLanguagePack(),
    query: "« Qué »",
  },
  {
    expectedToken: "何",
    fact: "題名は「何」です。",
    label: "Japanese quoted",
    locale: "ja-JP",
    pack: createJapaneseLanguagePack(),
    query: "「何」",
  },
  {
    expectedToken: "어떤",
    fact: "제목은 “어떤”입니다.",
    label: "Korean quoted",
    locale: "ko-KR",
    pack: createKoreanLanguagePack(),
    query: "“어떤”",
  },
];

async function seedHistoricalFactAndRecall(input: {
  fact: string;
  locale: string;
  query: string;
  userId: string;
}) {
  const memory = createGoodMemory({
    retrieval: { preset: "recommended" },
    storage: { provider: "memory" },
  });
  const scope = { userId: input.userId };
  const remembered = await memory.remember({
    annotations: [{
      confirmed: true,
      kindHint: "fact",
      messageIndex: 0,
      remember: "always",
    }],
    locale: input.locale,
    messages: [{ content: input.fact, role: "user" }],
    scope,
  });
  const rulesOnly = await memory.recall({
    locale: input.locale,
    query: input.query,
    scope,
    strategy: "rules-only",
  });
  const providerFreeRecommended = await memory.recall({
    locale: input.locale,
    query: input.query,
    scope,
  });

  expect(remembered.accepted).toBeGreaterThan(0);
  expect(rulesOnly.metadata.routingDecision.strategy).toBe("rules-only");
  expect(providerFreeRecommended.metadata.routingDecision.strategy).toBe(
    "hybrid",
  );
  return { providerFreeRecommended, rulesOnly };
}

describe("interrogative retrieval-noise variants", () => {
  for (const [index, testCase] of OMITTED_INTERROGATIVE_FORMS.entries()) {
    it(`${testCase.locale} rejects an omitted interrogative form in both provider-free routes`, async () => {
      const result = await seedHistoricalFactAndRecall({
        fact: testCase.badFact,
        locale: testCase.locale,
        query: testCase.query,
        userId: `interrogative-noise-${index}`,
      });

      expect(result.rulesOnly.facts).toEqual([]);
      expect(result.providerFreeRecommended.facts).toEqual([]);
    });
  }
});

describe("legitimate interrogative literals", () => {
  for (const [index, testCase] of LEGITIMATE_LITERALS.entries()) {
    it(`${testCase.label} remains searchable and recallable`, async () => {
      expect(
        testCase.pack.tokenizeForScoring(testCase.query, "bm25", {
          excludeStopwords: true,
        }),
      ).toContain(testCase.expectedToken);
      expect(testCase.pack.buildSearchTerms(testCase.query)).toContain(
        testCase.expectedToken,
      );

      const result = await seedHistoricalFactAndRecall({
        fact: testCase.fact,
        locale: testCase.locale,
        query: testCase.query,
        userId: `interrogative-literal-${index}`,
      });

      expect(result.rulesOnly.facts.map(({ content }) => content)).toContain(
        testCase.fact,
      );
      expect(
        result.providerFreeRecommended.facts.map(({ content }) => content),
      ).toContain(testCase.fact);
    });
  }
});

it("keeps Japanese compound lexemes intact in retrieval terms", async () => {
  const pack = createJapaneseLanguagePack();
  const text = "幾何学の本";

  expect(
    pack.tokenizeForScoring(text, "bm25", { excludeStopwords: true }),
  ).toContain("幾何");
  expect(pack.buildSearchTerms(text)).toContain("幾何");

  const fact = "私は幾何学の本を使います。";
  const result = await seedHistoricalFactAndRecall({
    fact,
    locale: "ja-JP",
    query: "幾何学",
    userId: "japanese-interrogative-compound",
  });

  expect(result.rulesOnly.facts.map(({ content }) => content)).toContain(fact);
  expect(
    result.providerFreeRecommended.facts.map(({ content }) => content),
  ).toContain(fact);
});
