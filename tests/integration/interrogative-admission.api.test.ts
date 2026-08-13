import { describe, expect, it } from "bun:test";

import { createGoodMemory } from "../../src";

const INTERROGATIVE_ADMISSION_CASES = [
  {
    assertion: "My preferred language is English.",
    locale: "en-US",
    question: "My preferred language is what?",
  },
  {
    assertion: "我正在做Tachikoma。",
    locale: "zh-CN",
    question: "你能帮我做什么？",
  },
  {
    assertion: "我昨天吃了番茄炒蛋。",
    locale: "zh-CN",
    question: "我昨天吃了什么？",
  },
  {
    assertion: "我正在做Tachikoma。",
    locale: "zh-TW",
    question: "你能幫我做什麼？",
  },
  {
    assertion: "我昨天吃了番茄炒蛋。",
    locale: "zh-TW",
    question: "我昨天吃了什麼？",
  },
  {
    assertion: "Mon rôle actuel est ingénieure plateforme.",
    locale: "fr-FR",
    question: "Mon rôle actuel est quoi ?",
  },
  {
    assertion: "Mi rol actual es ingeniera de plataforma.",
    locale: "es-ES",
    question: "Mi rol actual es cuál?",
  },
  {
    assertion: "私の現在の役割はプラットフォームエンジニアです。",
    locale: "ja-JP",
    question: "私の現在の役割は何ですか？",
  },
  {
    assertion: "現在のプロジェクトはTachikomaです。",
    locale: "ja-JP",
    question: "現在のプロジェクトは何ですか？",
  },
  {
    assertion: "제 현재 역할은 플랫폼 엔지니어입니다.",
    locale: "ko-KR",
    question: "제 현재 역할은 무엇인가요?",
  },
  {
    assertion: "현재 프로젝트는 Tachikoma입니다.",
    locale: "ko-KR",
    question: "현재 프로젝트는 무엇인가요?",
  },
] as const;

const MIXED_CLAUSE_CASES = [
  {
    expectedRole: "platform engineer",
    locale: "en-US",
    message: "I'm a platform engineer, what should I do next?",
  },
  {
    expectedRole: "平台工程师",
    locale: "zh-CN",
    message: "我是平台工程师，下一步做什么？",
  },
  {
    expectedRole: "平台工程師",
    locale: "zh-TW",
    message: "我是平台工程師，下一步做什麼？",
  },
  {
    expectedRole: "ingénieure plateforme",
    locale: "fr-FR",
    message: "Mon rôle actuel est ingénieure plateforme, que dois-je faire ensuite ?",
  },
  {
    expectedRole: "ingeniera de plataforma",
    locale: "es-ES",
    message: "Mi rol actual es ingeniera de plataforma, ¿qué debo hacer después?",
  },
  {
    expectedRole: "プラットフォームエンジニア",
    locale: "ja-JP",
    message: "私の現在の役割はプラットフォームエンジニアです、次に何をすべきですか？",
  },
  {
    expectedRole: "플랫폼 엔지니어",
    locale: "ko-KR",
    message: "제 현재 역할은 플랫폼 엔지니어입니다, 다음에 무엇을 해야 하나요?",
  },
] as const;

const LEGACY_RECALL_CASES = [
  {
    badFact: "What am I doing?",
    goodFact: "This image depicts a mountain landscape.",
    goodQuery: "What landscape is depicted in this image?",
    locale: "en-US",
    query: "What is drawn in this image?",
  },
  {
    badFact: "我正在做什么。",
    goodFact: "这张图片画着一座雪山。",
    goodQuery: "这张图片画着什么？",
    locale: "zh-CN",
    query: "这张图片里画的是什么？",
  },
  {
    badFact: "我正在做什麼。",
    goodFact: "這張圖片畫著一座雪山。",
    goodQuery: "這張圖片畫著什麼？",
    locale: "zh-TW",
    query: "這張圖片裡畫的是什麼？",
  },
  {
    badFact: "Je fais quoi ?",
    goodFact: "Cette image montre une montagne.",
    goodQuery: "Cette image montre quelle montagne ?",
    locale: "fr-FR",
    query: "Cette image montre quoi ?",
  },
  {
    badFact: "Estoy haciendo qué?",
    goodFact: "Esta imagen muestra una montaña.",
    goodQuery: "¿Qué montaña muestra esta imagen?",
    locale: "es-ES",
    query: "¿Qué hay dibujado en esta imagen?",
  },
  {
    badFact: "私は何をしていますか？",
    goodFact: "この画像には富士山が描かれています。",
    goodQuery: "この画像には何が描かれていますか？",
    locale: "ja-JP",
    query: "この画像には何が描かれていますか？",
  },
  {
    badFact: "저는 뭐예요?",
    goodFact: "이 이미지에는 산이 그려져 있습니다.",
    goodQuery: "이 이미지에는 무엇이 그려져 있나요?",
    locale: "ko-KR",
    query: "이 이미지에는 뭐예요?",
  },
] as const;

describe("public interrogative admission", () => {
  for (const [index, testCase] of INTERROGATIVE_ADMISSION_CASES.entries()) {
    it(`${testCase.locale} does not persist a bare question`, async () => {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: `question-admission-${index}` };

      const result = await memory.remember({
        locale: testCase.locale,
        messages: [{ content: testCase.question, role: "user" }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });

      expect(result.accepted).toBe(0);
      expect(exported.durable.profile).toBeNull();
      expect(exported.durable.preferences).toEqual([]);
      expect(exported.durable.references).toEqual([]);
      expect(exported.durable.facts).toEqual([]);
      expect(exported.durable.feedback).toEqual([]);
      expect(exported.durable.episodes).toEqual([]);
      expect(exported.durable.archives).toEqual([]);
      expect(exported.durable.evidence).toEqual([]);
      expect(exported.durable.experiences).toEqual([
        expect.objectContaining({
          linkedMemoryIds: [],
          metrics: { accepted: 0, rejected: 1 },
        }),
      ]);
      expect(exported.durable.proposals).toEqual([]);
      expect(exported.durable.promotions).toEqual([]);
    });

    it(`${testCase.locale} does not require question punctuation to abstain`, async () => {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: `unpunctuated-question-admission-${index}` };

      const result = await memory.remember({
        locale: testCase.locale,
        messages: [{
          content: testCase.question.replace(/[?？¿]/gu, "").trim(),
          role: "user",
        }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });

      expect(result.accepted).toBe(0);
      expect(exported.durable.profile).toBeNull();
      expect(exported.durable.preferences).toEqual([]);
      expect(exported.durable.references).toEqual([]);
      expect(exported.durable.facts).toEqual([]);
      expect(exported.durable.feedback).toEqual([]);
      expect(exported.durable.episodes).toEqual([]);
      expect(exported.durable.archives).toEqual([]);
      expect(exported.durable.evidence).toEqual([]);
      expect(exported.durable.experiences).toEqual([
        expect.objectContaining({
          linkedMemoryIds: [],
          metrics: { accepted: 0, rejected: 1 },
        }),
      ]);
      expect(exported.durable.proposals).toEqual([]);
      expect(exported.durable.promotions).toEqual([]);
    });

    it(`${testCase.locale} still persists the paired assertion`, async () => {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: `assertion-admission-${index}` };

      const result = await memory.remember({
        locale: testCase.locale,
        messages: [{ content: testCase.assertion, role: "user" }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });

      expect(result.accepted).toBeGreaterThan(0);
      expect(
        exported.durable.profile !== null ||
          exported.durable.facts.length > 0,
      ).toBe(true);
    });
  }

  for (const [index, testCase] of MIXED_CLAUSE_CASES.entries()) {
    it(`${testCase.locale} persists only the assertion in a mixed clause`, async () => {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: `mixed-question-admission-${index}` };

      await memory.remember({
        locale: testCase.locale,
        messages: [{ content: testCase.message, role: "user" }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });

      expect(exported.durable.profile?.identity.role).toBe(
        testCase.expectedRole,
      );
      expect(exported.durable.facts).toEqual([]);
    });
  }
});

describe("legacy interrogative-only recall", () => {
  for (const [index, testCase] of LEGACY_RECALL_CASES.entries()) {
    it(`${testCase.locale} does not use an interrogative token as recall evidence`, async () => {
      const memory = createGoodMemory({
        retrieval: { preset: "recommended" },
        storage: { provider: "memory" },
      });
      const scope = { userId: `legacy-question-${index}` };

      const remembered = await memory.remember({
        annotations: [{
          confirmed: true,
          kindHint: "fact",
          messageIndex: 0,
          remember: "always",
        }],
        locale: testCase.locale,
        messages: [{ content: testCase.badFact, role: "user" }],
        scope,
      });
      const rulesOnly = await memory.recall({
        locale: testCase.locale,
        query: testCase.query,
        scope,
        strategy: "rules-only",
      });
      const providerFreeRecommended = await memory.recall({
        locale: testCase.locale,
        query: testCase.query,
        scope,
      });
      const substantive = await memory.remember({
        annotations: [{
          confirmed: true,
          kindHint: "fact",
          messageIndex: 0,
          remember: "always",
        }],
        locale: testCase.locale,
        messages: [{ content: testCase.goodFact, role: "user" }],
        scope,
      });
      const substantiveRecall = await memory.recall({
        locale: testCase.locale,
        query: testCase.goodQuery,
        scope,
        strategy: "rules-only",
      });

      expect(remembered.accepted).toBeGreaterThan(0);
      expect(substantive.accepted).toBeGreaterThan(0);
      expect(rulesOnly.facts).toEqual([]);
      expect(providerFreeRecommended.facts).toEqual([]);
      expect(providerFreeRecommended.metadata.routingDecision.strategy).toBe(
        "hybrid",
      );
      expect(substantiveRecall.facts.map(({ content }) => content)).toContain(
        testCase.goodFact,
      );
    });
  }
});
