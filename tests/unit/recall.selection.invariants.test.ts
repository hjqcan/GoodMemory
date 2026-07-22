import { describe, expect, it } from "bun:test";
import { createFactMemory } from "../../src/domain/records";
import type { FactMemory } from "../../src/domain/records";
import { createLanguageService } from "../../src/language";
import type { RoutingDecision } from "../../src/recall/router";
import { buildFactCandidates, rankFactCandidates } from "../../src/recall/scoring";
import {
  selectFacts,
  selectGeneralizedFactsForInternalUse,
} from "../../src/recall/selection";

const TIMESTAMP = "2026-01-10T00:00:00.000Z";
const SOURCE = {
  method: "explicit" as const,
  extractedAt: TIMESTAMP,
};

function buildRoutingDecision(
  overrides: Partial<RoutingDecision>,
): RoutingDecision {
  return {
    retrievalProfile: "general_chat",
    intent: "general_assistance",
    strategy: "rules-only",
    strategyExplanation: {
      requestedStrategy: "rules-only",
      resolvedStrategy: "rules-only",
      summary: "rules-only",
      hardFloor: "lexical_runtime_procedural_priors",
      semanticTieBreaking: false,
      llmRefinement: false,
    },
    sourcePriorities: ["profile", "fact", "feedback"],
    requestedSlots: [],
    supportSlots: [],
    actionDriving: false,
    referenceSeeking: false,
    continuation: false,
    ...overrides,
  };
}

// Deterministic mulberry32-style generator so failures reproduce by seed.
function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)] as T;
}

const ENGLISH_CONTENT_BANK = [
  "I met Kelly at the book club event last month and we discussed the reading list together.",
  "I've never met Kelly at any book club or library events, so I wouldn't recognize her in person.",
  "I'm planning my garden redesign and I started by measuring the backyard layout.",
  "I built three raised garden beds for the redesign and tested the drainage.",
  "I installed solar path lighting around the redesigned garden borders.",
  "I completed 10 triangle classification problems, scoring 8 out of 10 correct.",
  "My accuracy in area calculation problems improved from 70% to 90% after practice.",
  "I bought new trail running shoes for my marathon training plan.",
  "I updated my weekly mileage target for the marathon training plan to 30 miles.",
  "The library reading room schedule changes every month and I keep forgetting the hours.",
  "I watched a documentary about coral reefs with my partner over the weekend.",
  "My monthly dining budget moved from $150 to $200 after we compromised.",
  "I finished reading The Nightingale and rated it five stars on my shelf.",
  "We hosted a movie night and Christopher volunteered to DJ with a playlist.",
  "I sketched planting zones for the backyard before ordering any seeds.",
] as const;

const CHINESE_CONTENT_BANK = [
  "我开始做花园改造，先测量了后院的布局并画了种植分区草图。",
  "我为花园改造搭建了三个高架种植床，还测试了排水效果。",
  "我上个月在球鞋展会上见过 Kyle，还和他聊了限量款的发售计划。",
  "我从来没见过 Kyle，也没参加过任何球鞋展会。",
  "我把每周的跑步里程目标更新到了三十公里。",
] as const;

const TAG_COMBOS: readonly (readonly string[] | undefined)[] = [
  ["source_message", "source_order", "user_answer"],
  ["source_message", "source_order", "assistant_answer"],
  ["source_message", "source_order"],
  ["dated_event"],
  undefined,
];

const CATEGORIES = ["project", "technical", "personal", "external_benchmark"] as const;

const QUERY_BANK: readonly { locale: string; query: string }[] = [
  { locale: "en", query: "Have I ever met Kelly at any book club or library event?" },
  {
    locale: "en",
    query:
      "Can you list the order in which I brought up different aspects of my garden redesign throughout our conversations, in order? Mention ONLY and ONLY three items.",
  },
  {
    locale: "en",
    query:
      "Can you walk me through the order in which I brought up different planning details for my movie marathons across our conversations in order? Mention ONLY and ONLY five items.",
  },
  {
    locale: "en",
    query:
      "What is my accuracy percentage in solving area calculation problems after completing 15 problems?",
  },
  { locale: "en", query: "How many books did I read last month?" },
  { locale: "en", query: "What did you recommend for my resume design?" },
  { locale: "en", query: "What is my current focus this week?" },
  { locale: "en", query: "Which sneakers did I decide to buy in the end?" },
  { locale: "zh-CN", query: "请按时间顺序列出我在我们的对话中提到的关于花园改造的不同方面。" },
  { locale: "zh-CN", query: "我有没有见过 Kyle 或者参加过球鞋展会？" },
];

interface GeneratedPool {
  facts: FactMemory[];
  locale: string;
  query: string;
  seed: number;
}

function generatePool(seed: number): GeneratedPool {
  const random = createSeededRandom(seed);
  const { locale, query } = pick(random, QUERY_BANK);
  const factCount = 6 + Math.floor(random() * 12);
  const facts: FactMemory[] = [];
  for (let index = 0; index < factCount; index += 1) {
    const chinese = locale.startsWith("zh") ? random() < 0.7 : random() < 0.1;
    const bank = chinese ? CHINESE_CONTENT_BANK : ENGLISH_CONTENT_BANK;
    const sourceOrder = 2 + index * 2;
    const tags = pick(random, TAG_COMBOS);
    facts.push(
      createFactMemory({
        id: `fact-${seed}-${index}`,
        userId: "user-1",
        category: pick(random, CATEGORIES),
        content: pick(random, bank),
        source: chinese ? { ...SOURCE, locale: "zh-CN" } : SOURCE,
        tags: tags ? [...tags] : undefined,
        attributes: tags?.includes("source_order") ? { sourceOrder } : undefined,
        lifecycle: random() < 0.15 ? "inactive" : "active",
        updatedAt: TIMESTAMP,
      }),
    );
  }
  return { facts, locale, query, seed };
}

const SEED_COUNT = 120;

describe("recall selection invariants", () => {
  it("exports selectFacts as the immutable generalized selector", () => {
    expect(selectFacts).toBe(selectGeneralizedFactsForInternalUse);
  });

  const language = createLanguageService();

  it("returns only active, locale-compatible, unique facts with bijective traces", () => {
    for (let seed = 1; seed <= SEED_COUNT; seed += 1) {
      const pool = generatePool(seed);
      const ranked = rankFactCandidates(
        buildFactCandidates(pool.facts, pool.query, language, pool.locale, TIMESTAMP),
        "rules-only",
      );
      const localeByFactId = new Map(
        ranked.map((entry) => [entry.fact.id, entry.locale]),
      );
      const result = selectFacts(
        pool.facts,
        pool.query,
        language,
        pool.locale,
        "general_chat",
        buildRoutingDecision({}),
        null,
        TIMESTAMP,
      );

      const context = `seed=${seed} query=${pool.query}`;

      // Invariant 1: compatibility.
      for (const fact of result.facts) {
        expect(fact.lifecycle, context).toBe("active");
        const factLocale = localeByFactId.get(fact.id);
        expect(factLocale, context).toBeDefined();
        expect(
          language.localesCompatible(pool.locale, factLocale ?? pool.locale),
          context,
        ).toBe(true);
      }

      // Invariant 4: no duplicate returns.
      const returnedIds = result.facts.map((fact) => fact.id);
      expect(new Set(returnedIds).size, context).toBe(returnedIds.length);

      // Invariant 2: result/trace bijection.
      const returnedTraceIds = result.traces
        .filter((trace) => trace.returned)
        .map((trace) => trace.memoryId);
      expect(new Set(returnedTraceIds), context).toEqual(new Set(returnedIds));
      for (const trace of result.traces) {
        if (trace.returned) {
          expect(trace.whyReturned, context).toBeDefined();
          expect(trace.whySuppressed, context).toBeUndefined();
        } else {
          expect(trace.whySuppressed, context).toBeDefined();
        }
      }

      // Invariant 3: traces cover every candidate in ranking order.
      expect(
        result.traces.map((trace) => trace.memoryId),
        context,
      ).toEqual(ranked.map((entry) => entry.fact.id));
    }
  });

  it("is deterministic and does not mutate its inputs", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const pool = generatePool(seed);
      const snapshot = JSON.stringify(pool.facts);
      const first = selectFacts(
        pool.facts,
        pool.query,
        language,
        pool.locale,
        "general_chat",
        buildRoutingDecision({}),
        null,
        TIMESTAMP,
      );
      const second = selectFacts(
        pool.facts,
        pool.query,
        language,
        pool.locale,
        "general_chat",
        buildRoutingDecision({}),
        null,
        TIMESTAMP,
      );

      expect(JSON.stringify(pool.facts)).toBe(snapshot);
      expect(second.facts.map((fact) => fact.id)).toEqual(
        first.facts.map((fact) => fact.id),
      );
      expect(second.traces).toEqual(first.traces);
    }
  });

  it("never returns assistant-answer turns for user-brought-up event-order queries", () => {
    const broughtUpQueries = [
      "Can you list the order in which I brought up different aspects of my garden redesign throughout our conversations, in order?",
      "Can you walk me through the order in which I brought up different planning details for my movie marathons across our conversations, in order?",
    ];
    for (let seed = 1; seed <= 40; seed += 1) {
      const random = createSeededRandom(seed * 7919);
      const query = pick(random, broughtUpQueries);
      const facts: FactMemory[] = [];
      const factCount = 6 + Math.floor(random() * 8);
      for (let index = 0; index < factCount; index += 1) {
        const isUser = index === 0 || random() < 0.5;
        facts.push(
          createFactMemory({
            id: `fact-brought-${seed}-${index}`,
            userId: "user-1",
            category: "external_benchmark",
            content: pick(random, ENGLISH_CONTENT_BANK),
            source: SOURCE,
            tags: [
              "source_message",
              "source_order",
              isUser ? "user_answer" : "assistant_answer",
            ],
            attributes: { sourceOrder: 2 + index * 2 },
            updatedAt: TIMESTAMP,
          }),
        );
      }

      const result = selectFacts(
        facts,
        query,
        language,
        "en",
        "general_chat",
        buildRoutingDecision({}),
        null,
        TIMESTAMP,
      );

      for (const fact of result.facts) {
        expect(
          fact.tags?.includes("assistant_answer") ?? false,
          `seed=${seed} fact=${fact.id}`,
        ).toBe(false);
      }
    }
  });

  it("returns empty facts for abstention-shaped queries", () => {
    const pool = generatePool(3);
    const trelloResult = selectFacts(
      pool.facts,
      "Did I give you specific criteria to prioritize tasks on my Trello board for sprint 1?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(trelloResult.facts).toEqual([]);
    expect(trelloResult.traces.filter((trace) => trace.returned)).toEqual([]);
  });

  it("returns empty facts and relabels traces for reference-only queries", () => {
    const pool = generatePool(5);
    const result = selectFacts(
      pool.facts,
      "Where is that style guide document you mentioned?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({ requestedSlots: ["reference"] }),
      null,
      TIMESTAMP,
    );

    expect(result.facts).toEqual([]);
    expect(result.traces.filter((trace) => trace.returned)).toEqual([]);
    // The relabel only rewrites "not selected"; lifecycle/locale suppressions keep
    // their original reason.
    for (const trace of result.traces) {
      expect(trace.whySuppressed).not.toBe("not selected");
      expect([
        "reference-only query",
        "inactive lifecycle",
        "locale mismatch",
      ]).toContain(trace.whySuppressed ?? "missing");
    }
  });

});
