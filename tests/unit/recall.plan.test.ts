import { describe, expect, it } from "bun:test";

import {
  createEnglishLanguagePack,
  createLanguageService,
} from "../../src/language";
import {
  buildDeterministicRecallPlan,
  resolveRecallPlan,
} from "../../src/recall/recallPlan";

const scope = { userId: "user-1", workspaceId: "workspace-1" };
const referenceTime = "2026-07-16T00:00:00.000Z";

function plan(query: string, locale = "en") {
  return buildDeterministicRecallPlan({
    language: createLanguageService(),
    locale,
    query,
    referenceTime,
    scope,
  });
}

describe("deterministic recall plan", () => {
  it("uses fixed global candidate, selection, and rendered-context limits", () => {
    expect(plan("Where do I live?")).toMatchObject({
      maxRenderedTokens: 6_000,
      preRankLimit: 32,
      selectedLimit: 12,
    });
  });

  it("plans Chinese multi-facet queries without whitespace token assumptions", () => {
    const result = plan("我用什么数据库以及后来换成了哪个编辑器？", "zh-CN");

    expect(result.facets).toEqual([
      "我用什么数据库",
      "后来换成了哪个编辑器",
    ]);
    expect(result.aggregation).toBe("change");
    expect(result.uncertainty).toBe("high");
  });

  it("plans Traditional Chinese and Japanese through their language packs", () => {
    const traditional = plan(
      "2026年5月之後，資料庫改成什麼，現在的阻礙是什麼？",
      "zh-TW",
    );
    expect(traditional).toMatchObject({
      aggregation: "change",
      maxHops: 1,
    });
    expect(traditional.temporalConstraints).toEqual([
      { kind: "current", referenceTime },
      { kind: "after", referenceTime: "2026-05-01T00:00:00.000Z" },
    ]);

    const japanese = plan(
      "先月以降、データベースは何に変更されましたか？",
      "ja-JP",
    );
    expect(japanese.aggregation).toBe("change");
    expect(japanese.temporalConstraints).toEqual([
      { kind: "after", referenceTime: "2026-06-01T00:00:00.000Z" },
    ]);

    const relation = plan("田中さんは何で知られていますか？", "ja-JP");
    expect(relation.maxHops).toBe(2);
    expect(relation.evidenceNeeds).toContain("relation");
    expect(relation.entities).toContain("田中さん");
  });

  it("does not mistake Chinese current markers for a before constraint", () => {
    for (const [query, locale] of [
      ["目前项目的阻塞是什么？", "zh-CN"],
      ["當前專案的阻礙是什麼？", "zh-TW"],
    ] as const) {
      expect(plan(query, locale).temporalConstraints).toEqual([
        { kind: "current", referenceTime },
      ]);
    }

    expect(plan("发布前的阻塞是什么？", "zh-CN").temporalConstraints).toEqual([
      { kind: "before", referenceTime },
    ]);
  });

  it("does not reinterpret a commercial partner query as a relationship facet", () => {
    const result = plan("Which partner API did Acme use?");

    expect(result.facets).toEqual([]);
    expect(result.entities).toEqual(["acme"]);
  });

  it("derives aggregation, temporal needs, and multi-hop depth from the query", () => {
    const currentCount = plan("How many current projects does Acme have?");
    expect(currentCount.aggregation).toBe("count");
    expect(currentCount.temporalConstraints).toEqual([
      { kind: "current", referenceTime },
    ]);
    expect(currentCount.evidenceNeeds).toContain("aggregation");

    const relation = plan("What is the goaltender known for?");
    expect(relation.maxHops).toBe(2);
    expect(relation.evidenceNeeds).toContain("relation");
  });

  it("uses an explicit query date as the before/after boundary", () => {
    expect(plan("2025 年以前的状态是什么？", "zh-CN").temporalConstraints).toEqual([
      { kind: "before", referenceTime: "2025-01-01T00:00:00.000Z" },
    ]);
    expect(plan("What changed after 2025-06-01?").temporalConstraints).toEqual([
      { kind: "after", referenceTime: "2025-06-01T00:00:00.000Z" },
    ]);
  });

  it("resolves slash dates consistently across English, Chinese, and Japanese", () => {
    for (const [query, locale] of [
      ["What happened before 2026/07/01?", "en"],
      ["2026/07/01之前发生了什么？", "zh-CN"],
      ["2026/07/01より前に何が起きましたか？", "ja-JP"],
    ] as const) {
      expect(plan(query, locale).temporalConstraints).toEqual([
        { kind: "before", referenceTime: "2026-07-01T00:00:00.000Z" },
      ]);
    }
  });

  it("uses tomorrow as a real before/after boundary in every built-in pack", () => {
    for (const [query, locale] of [
      ["What happens after tomorrow?", "en"],
      ["明天之后有什么变化？", "zh-CN"],
      ["明日以降に何が変わりますか？", "ja-JP"],
    ] as const) {
      expect(plan(query, locale).temporalConstraints).toEqual([
        { kind: "after", referenceTime: "2026-07-17T00:00:00.000Z" },
      ]);
    }
  });

  it("resolves month-name, quarter, season, and relative anchors deterministically", () => {
    // Month name + year anchors to the month start.
    expect(plan("What changed after May 2026?").temporalConstraints).toEqual([
      { kind: "after", referenceTime: "2026-05-01T00:00:00.000Z" },
    ]);
    // Month name + day + year anchors to the day.
    expect(
      plan("What happened before March 5, 2026?").temporalConstraints,
    ).toEqual([
      { kind: "before", referenceTime: "2026-03-05T00:00:00.000Z" },
    ]);
    // A bare month resolves to its most recent occurrence at or before the
    // reference time (reference is 2026-07-16).
    expect(plan("What did we ship after May?").temporalConstraints).toEqual([
      { kind: "after", referenceTime: "2026-05-01T00:00:00.000Z" },
    ]);
    // "last <month>" after the reference month rolls to the previous year.
    expect(
      plan("What happened after last September?").temporalConstraints,
    ).toEqual([
      { kind: "after", referenceTime: "2025-09-01T00:00:00.000Z" },
    ]);
    // Quarters anchor to the quarter start.
    expect(plan("What shipped after Q2 2026?").temporalConstraints).toEqual([
      { kind: "after", referenceTime: "2026-04-01T00:00:00.000Z" },
    ]);
    // Seasons use fixed northern-hemisphere calendar starts.
    expect(
      plan("What was planned before summer 2026?").temporalConstraints,
    ).toEqual([
      { kind: "before", referenceTime: "2026-06-01T00:00:00.000Z" },
    ]);
    // Relative offsets resolve against the reference time at day precision.
    expect(plan("What changed after last week?").temporalConstraints).toEqual([
      { kind: "after", referenceTime: "2026-07-09T00:00:00.000Z" },
    ]);
    expect(
      plan("What happened before 3 days ago?").temporalConstraints,
    ).toEqual([
      { kind: "before", referenceTime: "2026-07-13T00:00:00.000Z" },
    ]);
    // Chinese year + numeric month.
    expect(
      plan("2026年5月之后有什么变化？", "zh-CN").temporalConstraints,
    ).toEqual([
      { kind: "after", referenceTime: "2026-05-01T00:00:00.000Z" },
    ]);
    // The modal verb "may" is not a month.
    expect(
      plan("What may change after the release?").temporalConstraints,
    ).toEqual([
      { kind: "after", referenceTime },
    ]);
  });

  it("classifies time-unit interval questions as temporal, not enumeration counts", () => {
    // "How many <time-unit>s passed/between" asks for an interval between two
    // anchors — a precision question. Counting instances would plan for
    // breadth instead.
    const interval = plan(
      "How many weeks passed between the bake sale and the marathon?",
    );
    expect(interval.aggregation).not.toBe("count");
    expect(interval.evidenceNeeds).toContain("temporal");

    const betweenDays = plan(
      "How many days were there between my MoMA visit and the exhibit?",
    );
    expect(betweenDays.aggregation).not.toBe("count");
    expect(betweenDays.evidenceNeeds).toContain("temporal");

    // True enumeration counts keep the count aggregation.
    const enumeration = plan("How many books did I buy last month?");
    expect(enumeration.aggregation).toBe("count");

    // Chinese interval phrasing is also not an enumeration count.
    const hanInterval = plan("这两次活动之间过了多少天？", "zh-CN");
    expect(hanInterval.aggregation).not.toBe("count");
  });

  it("plans source-derived temporal operands as focused recall facets", () => {
    const ordered = plan(
      "Which event happened first, the laptop repair or the router replacement?",
    );
    expect(ordered.facets).toEqual([
      "the laptop repair",
      "the router replacement",
    ]);
    expect(ordered.evidenceNeeds).toContain("multi_facet");

    const elapsed = plan(
      "How many days ago did I attend a pottery class when I made the vase?",
    );
    expect(elapsed.facets).toEqual([
      "I attend a pottery class",
      "I made the vase",
    ]);

    const singleEvent = plan(
      "How many days ago did I attend a community workshop?",
    );
    expect(singleEvent.facets).toEqual(["I attend a community workshop"]);
    expect(singleEvent.evidenceNeeds).toContain("temporal");

    const passedSince = plan(
      "How many days have passed since I attended a community workshop?",
    );
    expect(passedSince.facets).toEqual(["I attended a community workshop"]);
    expect(passedSince.aggregation).not.toBe("count");
    expect(passedSince.evidenceNeeds).toContain("temporal");

    const oneWordEvents = plan(
      "Which event, lunch or dinner, happened first?",
    );
    expect(oneWordEvents.facets).toEqual(["lunch", "dinner"]);
    expect(oneWordEvents.evidenceNeeds).toContain("temporal");
  });

  it("lets an optional query-only assistant refine the plan without changing fixed budgets", async () => {
    const result = await resolveRecallPlan({
      input: {
        locale: "zh-CN",
        query: "告诉我这两个项目现在的状态",
        referenceTime,
        scope,
      },
      assistant: {
        async plan(input) {
          expect(Object.keys(input).sort()).toEqual([
            "deterministicPlan",
            "locale",
            "query",
            "referenceTime",
            "scope",
          ]);
          return {
            ...input.deterministicPlan,
            entities: ["Atlas", "Beacon"],
            facets: ["Atlas 现在的状态", "Beacon 现在的状态"],
            maxHops: 2,
            preRankLimit: 999,
            selectedLimit: 999,
            maxRenderedTokens: 999_999,
          };
        },
      },
    });

    expect(result.assistantApplied).toBe(true);
    expect(result.plan).toMatchObject({
      entities: ["Atlas", "Beacon"],
      facets: ["Atlas 现在的状态", "Beacon 现在的状态"],
      maxHops: 1,
      preRankLimit: 32,
      selectedLimit: 12,
      maxRenderedTokens: 6_000,
    });
  });

  it("does not spend a provider call on a low-uncertainty single-intent plan", async () => {
    let calls = 0;
    const input = {
      query: "What specific themes are explored in Joanna's new book?",
      referenceTime,
      scope,
    };

    const result = await resolveRecallPlan({
      input,
      assistant: {
        async plan() {
          calls += 1;
          return {
            facets: ["book", "themes"],
            maxHops: 2,
          };
        },
      },
    });

    expect(calls).toBe(0);
    expect(result).toEqual({
      assistantApplied: false,
      plan: buildDeterministicRecallPlan(input),
    });
  });

  it("admits only entity-anchored facets and preserves deterministic capabilities", async () => {
    const result = await resolveRecallPlan({
      input: {
        query: "What database do I use and which editor did I switch to?",
        referenceTime,
        scope,
      },
      assistant: {
        async plan() {
          return {
            entities: ["Atlas", "Beacon"],
            evidenceNeeds: [],
            facets: ["database", "Atlas current status", "themes"],
            maxHops: 3,
            planes: [],
            temporalConstraints: [
              { kind: "current", referenceTime },
            ],
          };
        },
      },
    });

    expect(result.assistantApplied).toBe(true);
    expect(result.plan.entities).toEqual(["Atlas", "Beacon"]);
    expect(result.plan.facets).toEqual([
      "What database do I use",
      "which editor did I switch to",
      "Atlas current status",
    ]);
    expect(result.plan.temporalConstraints).toEqual([]);
    expect(result.plan.evidenceNeeds).toEqual(
      expect.arrayContaining(["direct", "aggregation", "multi_facet", "temporal"]),
    );
    expect(result.plan.planes).toEqual(
      expect.arrayContaining(["semantic", "episodic"]),
    );
    expect(result.plan.maxHops).toBe(1);
  });

  it("anchors assisted facets with the request LanguagePack equality semantics", async () => {
    const english = createEnglishLanguagePack();
    const language = createLanguageService({
      packs: [{
        ...english,
        analyzerVersion: "sentinel-equality-v1",
        normalizeForEquality(text) {
          return english.normalizeForEquality(text).replaceAll("colour", "color");
        },
      }],
    });

    const result = await resolveRecallPlan({
      input: {
        language,
        locale: "en",
        query: "What database do I use and which editor did I switch to?",
        referenceTime,
        scope,
      },
      assistant: {
        async plan() {
          return {
            entities: ["colour"],
            facets: ["color preference"],
          };
        },
      },
    });

    expect(result.plan.facets).toContain("color preference");
  });

  it("falls back to the deterministic plan when the optional assistant fails", async () => {
    const input = {
      query: "What database do I use and which editor did I switch to?",
      referenceTime,
      scope,
    };
    const result = await resolveRecallPlan({
      input,
      assistant: {
        async plan() {
          throw new Error("provider unavailable");
        },
      },
    });

    expect(result).toEqual({
      assistantApplied: false,
      fallbackReason: "assistant_error",
      plan: buildDeterministicRecallPlan(input),
    });
  });
});
