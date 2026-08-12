import { describe, expect, it } from "bun:test";

import { createLanguageService } from "../../../src/language";

const EVENT_QUERY_CASES = [
  {
    locale: "en-US",
    boundary: "What happened before 3 days ago?",
    queries: [
      "What did I eat yesterday?",
      "What happened yesterday?",
      "What did I finish 3 days ago?",
      "What did I eat on 2026-08-09?",
      "Which runbook did I update yesterday?",
      "Where did I eat yesterday?",
      "Who did I meet yesterday?",
    ],
    literals: [
      "What is Project Yesterday?",
      "Which movie is Yesterday?",
      "What happened to Project Yesterday?",
      "What will I eat tomorrow?",
    ],
  },
  {
    locale: "zh-CN",
    boundary: "3天前之前发生了什么？",
    queries: [
      "我昨天吃了什么？",
      "昨天发生了什么？",
      "我3天前完成了什么？",
      "我2026年8月9日吃了什么？",
      "我昨天更新了哪份运行手册？",
      "我昨天修理了什么？",
      "我昨天在哪里吃了饭？",
      "我昨天见了谁？",
    ],
    literals: [
      "Project Yesterday 是什么？",
      "电影《昨日》是什么？",
      "电影《昨日》发生了什么？",
      "我明天吃什么？",
    ],
  },
  {
    locale: "zh-TW",
    boundary: "3天前之前發生了什麼？",
    queries: [
      "我昨天吃了什麼？",
      "昨天發生了什麼？",
      "我3天前完成了什麼？",
      "我2026年8月9日吃了什麼？",
      "我昨天更新了哪份操作手冊？",
      "我昨天修理了什麼？",
      "我昨天在哪裡吃了飯？",
      "我昨天見了誰？",
    ],
    literals: [
      "Project Yesterday 是什麼？",
      "電影《昨日》是什麼？",
      "電影《昨日》發生了什麼？",
      "我明天吃什麼？",
    ],
  },
  {
    locale: "fr-FR",
    boundary: "Que s’est-il passé avant le 9 août 2026 ?",
    queries: [
      "Qu’est-ce que j’ai mangé hier ?",
      "Que s’est-il passé hier ?",
      "Qu’est-ce que j’ai terminé il y a 3 jours ?",
      "Qu’est-ce que j’ai mangé le 9 août 2026 ?",
      "Quel guide ai-je mis à jour hier ?",
      "Où ai-je mangé hier ?",
      "Qui ai-je rencontré hier ?",
    ],
    literals: [
      "Qu’est-ce que le projet Yesterday ?",
      "Quel film s’appelle Hier ?",
      "Que s’est-il passé avec le projet Hier ?",
      "Qu’est-ce que je mangerai demain ?",
    ],
  },
  {
    locale: "es-ES",
    boundary: "¿Qué pasó antes del 9 de agosto de 2026?",
    queries: [
      "¿Qué comí ayer?",
      "¿Qué pasó ayer?",
      "¿Qué terminé hace 3 días?",
      "¿Qué comí el 9 de agosto de 2026?",
      "¿Qué guía actualicé ayer?",
      "¿Dónde comí ayer?",
      "¿A quién conocí ayer?",
    ],
    literals: [
      "¿Qué es el proyecto Yesterday?",
      "¿Qué película se llama Ayer?",
      "¿Qué pasó con el proyecto Ayer?",
      "¿Qué comeré mañana?",
    ],
  },
  {
    locale: "ja-JP",
    boundary: "3日前より前に何が起きましたか？",
    queries: [
      "昨日何を食べましたか？",
      "昨日何が起きましたか？",
      "3日前に何を完了しましたか？",
      "2026年8月9日に何を食べましたか？",
      "昨日どの手順書を更新しましたか？",
      "昨日どこで食べましたか？",
      "昨日誰に会いましたか？",
    ],
    literals: [
      "Project Yesterdayとは何ですか？",
      "映画「昨日」は何ですか？",
      "映画「昨日」に何が起きましたか？",
      "明日何を食べますか？",
    ],
  },
  {
    locale: "ko-KR",
    boundary: "3일 전보다 앞서 무슨 일이 있었나요?",
    queries: [
      "어제 무엇을 먹었나요?",
      "어제 무슨 일이 있었나요?",
      "3일 전에 무엇을 완료했나요?",
      "2026년 8월 9일에 무엇을 먹었나요?",
      "어제 어떤 실행서를 업데이트했나요?",
      "저는 어제 무엇을 수리했습니까?",
      "어제 어디에서 먹었나요?",
      "어제 누구를 만났나요?",
    ],
    literals: [
      "Project Yesterday는 무엇인가요?",
      "영화 Yesterday는 무엇인가요?",
      "영화 「어제」에 무슨 일이 있었나요?",
      "내일 무엇을 먹을까요?",
    ],
  },
] as const;

describe("event occurrence query disposition", () => {
  const language = createLanguageService();

  it("marks explicit completed-event date lookups in every built-in locale", () => {
    for (const { locale, queries } of EVENT_QUERY_CASES) {
      for (const query of queries) {
        const context = language.resolveFromText({ locale, text: query });
        expect(
          language.analyzeQuery(query, context).eventOccurrenceQuery,
          `${locale}: ${query}`,
        ).toBe(true);
        expect(
          language.analyzeQuery(query, context).eventOccurrenceQueryMode,
          `${locale}: ${query}`,
        ).toBe(query.includes("happened") || query.includes("发生") ||
            query.includes("發生") || query.includes("passé") ||
            query.includes("pasó") || query.includes("起き") ||
            query.includes("무슨 일")
          ? "broad"
          : "predicate");
      }
    }
  });

  it("does not treat names and literal titles as event date lookups", () => {
    for (const { locale, literals } of EVENT_QUERY_CASES) {
      for (const query of literals) {
        const context = language.resolveFromText({ locale, text: query });
        expect(
          language.analyzeQuery(query, context).eventOccurrenceQuery,
          `${locale}: ${query}`,
        ).not.toBe(true);
      }
    }
  });

  it("leaves explicit temporal boundaries to before/after disposition", () => {
    for (const { boundary, locale } of EVENT_QUERY_CASES) {
      const context = language.resolveFromText({ locale, text: boundary });
      const analysis = language.analyzeQuery(boundary, context);
      expect(analysis.eventOccurrenceQuery, `${locale}: ${boundary}`).not.toBe(
        true,
      );
      expect(analysis.before, `${locale}: ${boundary}`).toBe(true);
    }
  });

  it("matches Korean completed-event predicates by their inflected stem", () => {
    const context = language.resolveFromText({
      locale: "ko-KR",
      text: "저는 어제 무엇을 수리했습니까?",
    });

    expect(language.matchesEventPredicate(
      "저는 어제 무엇을 수리했습니까?",
      "저는 정원 문을 수리했습니다.",
      context,
    )).toBe(true);
    expect(language.matchesEventPredicate(
      "저는 어제 무엇을 했습니까?",
      "저는 정원 일을 했습니다.",
      context,
    )).toBe(true);
    expect(language.matchesEventPredicate(
      "저는 어제 무엇을 수리했습니까?",
      "저는 배포를 완료했습니다.",
      context,
    )).toBe(false);
  });
});
