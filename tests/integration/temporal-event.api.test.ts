import { describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGoodMemory } from "../../src";

const SHANGHAI_YESTERDAY = {
  endExclusive: "2026-08-11T16:00:00.000Z",
  precision: "day",
  start: "2026-08-10T16:00:00.000Z",
  timezone: "Asia/Shanghai",
} as const;

const SHANGHAI_THREE_DAYS_AGO = {
  endExclusive: "2026-08-09T16:00:00.000Z",
  precision: "day",
  start: "2026-08-08T16:00:00.000Z",
  timezone: "Asia/Shanghai",
} as const;

describe("public temporal event memory", () => {
  it("does not let a same-day occurrence answer an unrelated event predicate", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = { userId: "temporal-predicate-fence" };
    await memory.remember({
      extractionStrategy: "rules-only",
      locale: "en-US",
      messages: [{
        content: "I updated the release runbook yesterday.",
        observedAt: "2026-08-12T03:00:00.000Z",
        role: "user",
        timezone: "Asia/Shanghai",
      }],
      scope,
    });

    for (const query of [
      "Where did I eat yesterday?",
      "Who did I meet yesterday?",
    ]) {
      const recalled = await memory.recall({
        locale: "en-US",
        query,
        referenceTime: "2026-08-12T04:00:00.000Z",
        scope,
        strategy: "rules-only",
        timezone: "Asia/Shanghai",
      });
      expect(recalled.facts, query).toEqual([]);
    }

    const broad = await memory.recall({
      locale: "en-US",
      query: "What happened yesterday?",
      referenceTime: "2026-08-12T04:00:00.000Z",
      scope,
      strategy: "rules-only",
      timezone: "Asia/Shanghai",
    });
    expect(broad.facts.map(({ content }) => content)).toEqual([
      "I updated the release runbook.",
    ]);
  });

  it("keeps a same-day event whose predicate matches despite weak wording overlap", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = { userId: "temporal-predicate-match" };
    await memory.remember({
      extractionStrategy: "rules-only",
      locale: "en-US",
      messages: [{
        content: "I ate at Blue Lantern yesterday.",
        observedAt: "2026-08-12T03:00:00.000Z",
        role: "user",
        timezone: "Asia/Shanghai",
      }],
      scope,
    });

    const recalled = await memory.recall({
      locale: "en-US",
      query: "Where did I eat yesterday?",
      referenceTime: "2026-08-12T04:00:00.000Z",
      scope,
      strategy: "rules-only",
      timezone: "Asia/Shanghai",
    });

    expect(recalled.facts.map(({ content }) => content)).toEqual([
      "I ate at Blue Lantern.",
    ]);
  });

  it("matches arbitrary regular English event predicates across sessions", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    for (const [index, statement] of [
      "I repaired the garden gate yesterday.",
      "I audited the release checklist yesterday.",
      "I cooked lentil soup yesterday.",
    ].entries()) {
      await memory.remember({
        extractionStrategy: "rules-only",
        locale: "en-US",
        messages: [{
          content: statement,
          observedAt: "2026-08-12T03:00:00.000Z",
          role: "user",
          timezone: "Asia/Shanghai",
        }],
        scope: { sessionId: `predicate-${index}`, userId: "temporal-regular-predicate" },
      });
    }

    for (const [query, expected] of [
      ["What did I repair yesterday?", "I repaired the garden gate."],
      ["What did I audit yesterday?", "I audited the release checklist."],
      ["What did I cook yesterday?", "I cooked lentil soup."],
    ] as const) {
      const recalled = await memory.recall({
        locale: "en-US",
        query,
        referenceTime: "2026-08-12T04:00:00.000Z",
        scope: { userId: "temporal-regular-predicate" },
        strategy: "rules-only",
        timezone: "Asia/Shanghai",
      });
      expect(recalled.facts.map(({ content }) => content), query).toContain(
        expected,
      );
    }
  });

  it("fences arbitrary completed Chinese predicates by their occurrence day", async () => {
    for (const testCase of [
      {
        expected: "我修理了花园门。",
        locale: "zh-CN",
        query: "我昨天修理了什么？",
        statement: "我昨天修理了花园门。",
      },
      {
        expected: "我修理了花園門。",
        locale: "zh-TW",
        query: "我昨天修理了什麼？",
        statement: "我昨天修理了花園門。",
      },
    ] as const) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: `temporal-generic-predicate-${testCase.locale}` };
      await memory.remember({
        extractionStrategy: "rules-only",
        locale: testCase.locale,
        messages: [{
          content: testCase.statement,
          observedAt: "2026-08-12T03:00:00.000Z",
          role: "user",
          timezone: "Asia/Shanghai",
        }],
        scope,
      });

      const sameDay = await memory.recall({
        locale: testCase.locale,
        query: testCase.query,
        referenceTime: "2026-08-12T04:00:00.000Z",
        scope,
        strategy: "rules-only",
        timezone: "Asia/Shanghai",
      });
      const nextDay = await memory.recall({
        locale: testCase.locale,
        query: testCase.query,
        referenceTime: "2026-08-13T04:00:00.000Z",
        scope,
        strategy: "rules-only",
        timezone: "Asia/Shanghai",
      });

      expect(sameDay.facts.map(({ content }) => content), testCase.locale)
        .toEqual([testCase.expected]);
      expect(nextDay.facts, testCase.locale).toEqual([]);
    }
  });

  it("matches a regular Korean completed predicate on the requested day only", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = { userId: "temporal-korean-regular-predicate" };
    const remembered = await memory.remember({
      extractionStrategy: "rules-only",
      locale: "ko-KR",
      messages: [{
        content: "저는 어제 정원 문을 수리했습니다.",
        observedAt: "2026-08-12T02:00:00.000Z",
        role: "user",
        timezone: "Asia/Seoul",
      }],
      scope,
    });
    const sameDay = await memory.recall({
      locale: "ko-KR",
      query: "저는 어제 무엇을 수리했습니까?",
      referenceTime: "2026-08-12T03:00:00.000Z",
      scope,
      strategy: "rules-only",
      timezone: "Asia/Seoul",
    });
    const nextDay = await memory.recall({
      locale: "ko-KR",
      query: "저는 어제 무엇을 수리했습니까?",
      referenceTime: "2026-08-13T03:00:00.000Z",
      scope,
      strategy: "rules-only",
      timezone: "Asia/Seoul",
    });

    expect(remembered).toMatchObject({ accepted: 1, rejected: 0 });
    expect(sameDay.facts.map(({ content }) => content)).toEqual([
      "저는 정원 문을 수리했습니다.",
    ]);
    expect(nextDay.facts).toEqual([]);
  });

  it("applies the same occurrence contract across every built-in locale", async () => {
    const cases = [
      {
        locale: "en-US",
        statement: "I ate tomato and eggs yesterday.",
        query: "What did I eat yesterday?",
      },
      {
        locale: "zh-CN",
        statement: "我昨天吃了番茄炒蛋。",
        query: "我昨天吃了什么？",
      },
      {
        locale: "zh-TW",
        statement: "我昨天吃了番茄炒蛋。",
        query: "我昨天吃了什麼？",
      },
      {
        locale: "fr-FR",
        statement: "J’ai mangé des œufs à la tomate hier.",
        query: "Qu’est-ce que j’ai mangé hier ?",
      },
      {
        locale: "es-ES",
        statement: "Comí huevos con tomate ayer.",
        query: "¿Qué comí ayer?",
      },
      {
        locale: "ja-JP",
        statement: "私は昨日トマトと卵を食べました。",
        query: "私は昨日何を食べましたか？",
      },
      {
        locale: "ko-KR",
        statement: "저는 어제 토마토 달걀을 먹었습니다.",
        query: "저는 어제 무엇을 먹었습니까?",
      },
    ] as const;

    for (const testCase of cases) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: `temporal-${testCase.locale}` };
      const remembered = await memory.remember({
        extractionStrategy: "rules-only",
        locale: testCase.locale,
        messages: [{
          content: testCase.statement,
          observedAt: "2026-08-12T02:00:00.000Z",
          role: "user",
          timezone: "Asia/Shanghai",
        }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });
      const recalled = await memory.recall({
        locale: testCase.locale,
        query: testCase.query,
        referenceTime: "2026-08-12T03:00:00.000Z",
        scope,
        strategy: "rules-only",
        timezone: "Asia/Shanghai",
      });
      const nextDay = await memory.recall({
        locale: testCase.locale,
        query: testCase.query,
        referenceTime: "2026-08-13T03:00:00.000Z",
        scope,
        strategy: "rules-only",
        timezone: "Asia/Shanghai",
      });

      expect(remembered, testCase.locale).toMatchObject({
        accepted: 1,
        rejected: 0,
      });
      expect(exported.durable.facts[0]?.occurrence, testCase.locale).toEqual(
        SHANGHAI_YESTERDAY,
      );
      expect(recalled.facts, testCase.locale).toHaveLength(1);
      expect(nextDay.facts, testCase.locale).toEqual([]);
    }
  });

  it("resolves N-days-ago writes and excludes them from the adjacent-day query across every built-in locale", async () => {
    const cases = [
      {
        adjacentQuery: "What did I eat on August 10, 2026?",
        locale: "en-US",
        matchingQuery: "What did I eat on August 9, 2026?",
        statement: "I ate rice 3 days ago.",
      },
      {
        adjacentQuery: "我2026年8月10日吃了什么？",
        locale: "zh-CN",
        matchingQuery: "我2026年8月9日吃了什么？",
        statement: "我3天前吃了米饭。",
      },
      {
        adjacentQuery: "我2026年8月10日吃了什麼？",
        locale: "zh-TW",
        matchingQuery: "我2026年8月9日吃了什麼？",
        statement: "我3天前吃了米飯。",
      },
      {
        adjacentQuery: "Qu’est-ce que j’ai mangé le 10 août 2026 ?",
        locale: "fr-FR",
        matchingQuery: "Qu’est-ce que j’ai mangé le 9 août 2026 ?",
        statement: "J’ai mangé du riz il y a 3 jours.",
      },
      {
        adjacentQuery: "¿Qué comí el 10 de agosto de 2026?",
        locale: "es-ES",
        matchingQuery: "¿Qué comí el 9 de agosto de 2026?",
        statement: "Comí arroz hace 3 días.",
      },
      {
        adjacentQuery: "私は2026年8月10日に何を食べましたか？",
        locale: "ja-JP",
        matchingQuery: "私は2026年8月9日に何を食べましたか？",
        statement: "私は3日前にご飯を食べました。",
      },
      {
        adjacentQuery: "저는 2026년 8월 10일에 무엇을 먹었습니까?",
        locale: "ko-KR",
        matchingQuery: "저는 2026년 8월 9일에 무엇을 먹었습니까?",
        statement: "저는 3일 전에 밥을 먹었습니다.",
      },
    ] as const;

    for (const testCase of cases) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: `temporal-n-days-${testCase.locale}` };
      const remembered = await memory.remember({
        extractionStrategy: "rules-only",
        locale: testCase.locale,
        messages: [{
          content: testCase.statement,
          observedAt: "2026-08-12T02:00:00.000Z",
          role: "user",
          timezone: "Asia/Shanghai",
        }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });
      const sameDay = await memory.recall({
        locale: testCase.locale,
        query: testCase.matchingQuery,
        referenceTime: "2026-08-12T03:00:00.000Z",
        scope,
        strategy: "rules-only",
        timezone: "Asia/Shanghai",
      });
      const adjacentDay = await memory.recall({
        locale: testCase.locale,
        query: testCase.adjacentQuery,
        referenceTime: "2026-08-12T03:00:00.000Z",
        scope,
        strategy: "rules-only",
        timezone: "Asia/Shanghai",
      });

      expect(remembered, testCase.locale).toMatchObject({
        accepted: 1,
        rejected: 0,
      });
      expect(exported.durable.facts[0]?.occurrence, testCase.locale).toEqual(
        SHANGHAI_THREE_DAYS_AGO,
      );
      expect(sameDay.facts, testCase.locale).toHaveLength(1);
      expect(adjacentDay.facts, testCase.locale).toEqual([]);
    }
  });

  it("preserves occurrence semantics across a sqlite reopen", async () => {
    const sqlitePath = join(
      tmpdir(),
      `goodmemory-temporal-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
    );
    const scope = {
      userId: "temporal-sqlite-user",
      workspaceId: "temporal-sqlite-workspace",
    };

    try {
      const writer = createGoodMemory({
        storage: { provider: "sqlite", url: sqlitePath },
      });
      await writer.remember({
        extractionStrategy: "rules-only",
        locale: "zh-CN",
        messages: [{
          content: "我昨天吃了番茄炒蛋。",
          observedAt: "2026-08-12T02:00:00.000Z",
          role: "user",
          timezone: "Asia/Shanghai",
        }],
        scope: { ...scope, sessionId: "write" },
      });

      const reader = createGoodMemory({
        storage: { provider: "sqlite", url: sqlitePath },
      });
      const exported = await reader.exportMemory({ scope });
      const recalled = await reader.recall({
        locale: "zh-CN",
        query: "我昨天吃了什么？",
        referenceTime: "2026-08-12T03:00:00.000Z",
        scope: { ...scope, sessionId: "read" },
        strategy: "rules-only",
        timezone: "Asia/Shanghai",
      });

      expect(exported.durable.facts[0]?.occurrence).toEqual(
        SHANGHAI_YESTERDAY,
      );
      expect(recalled.facts.map(({ content }) => content)).toEqual([
        "我吃了番茄炒蛋。",
      ]);
    } finally {
      await rm(sqlitePath, { force: true });
      await rm(`${sqlitePath}-shm`, { force: true });
      await rm(`${sqlitePath}-wal`, { force: true });
    }
  });

  it("applies one occurrence fence across every routing strategy and reranking", async () => {
    const rerankerWindows: string[][] = [];
    const memory = createGoodMemory({
      adapters: {
        embeddingAdapter: {
          async embed(values) {
            return values.map(() => [1, 0]);
          },
        },
        reranker: {
          async rerank({ documents }) {
            rerankerWindows.push(documents.map(({ text }) => text));
            return documents.map(({ id }, index) => ({ id, score: -index }));
          },
        },
      },
      storage: { provider: "memory" },
    });
    const scope = { userId: "temporal-routing-fence-user" };
    await memory.remember({
      extractionStrategy: "rules-only",
      locale: "zh-CN",
      messages: [
        {
          content: "我昨天吃了番茄炒蛋。",
          observedAt: "2026-08-12T02:00:00.000Z",
          role: "user",
          timezone: "Asia/Shanghai",
        },
        {
          content: "我昨天吃了饺子。",
          observedAt: "2026-08-12T02:30:00.000Z",
          role: "user",
          timezone: "Asia/Shanghai",
        },
        {
          content: "我今天吃了牛肉面。",
          observedAt: "2026-08-12T03:00:00.000Z",
          role: "user",
          timezone: "Asia/Shanghai",
        },
      ],
      scope,
    });

    for (const strategy of [
      "rules-only",
      "hybrid",
      "auto",
      "llm-assisted",
    ] as const) {
      const recalled = await memory.recall({
        locale: "zh-CN",
        query: "我昨天吃了什么？",
        referenceTime: "2026-08-12T04:00:00.000Z",
        scope,
        strategy,
        timezone: "Asia/Shanghai",
      });

      expect(
        new Set(recalled.facts.map(({ content }) => content)),
        strategy,
      ).toEqual(new Set(["我吃了番茄炒蛋。", "我吃了饺子。"]));
    }
    expect(rerankerWindows).not.toEqual([]);
    expect(rerankerWindows.flat().some((text) => text.includes("牛肉面")))
      .toBeFalse();
  });

  it("answers a same-day cross-session yesterday query with absolute occurrence evidence", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const durableScope = {
      userId: "temporal-cross-session-user",
      workspaceId: "temporal-cross-session-workspace",
    };

    const remembered = await memory.remember({
      extractionStrategy: "rules-only",
      locale: "zh-CN",
      messages: [
        {
          content: "我昨天吃了番茄炒蛋。",
          observedAt: "2026-08-12T02:00:00.000Z",
          role: "user",
          timezone: "Asia/Shanghai",
        },
      ],
      scope: { ...durableScope, sessionId: "teach" },
    });
    const recalled = await memory.recall({
      locale: "zh-CN",
      query: "我昨天吃了什么？",
      referenceTime: "2026-08-12T03:00:00.000Z",
      scope: { ...durableScope, sessionId: "ask-same-day" },
      strategy: "rules-only",
      timezone: "Asia/Shanghai",
    });
    const context = await memory.buildContext({ recall: recalled });

    expect(remembered).toMatchObject({ accepted: 1, rejected: 0 });
    expect(recalled.facts).toHaveLength(1);
    expect(recalled.facts[0]).toMatchObject({
      category: "event",
      content: "我吃了番茄炒蛋。",
      occurrence: SHANGHAI_YESTERDAY,
      validFrom: undefined,
      validUntil: undefined,
    });
    expect(context.content).toContain("[2026-08-11, Asia/Shanghai]");
    expect(context.content).toContain("番茄炒蛋");
  });

  it("excludes yesterday events on the next local day and excludes today's event on the original day", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const durableScope = {
      userId: "temporal-day-fence-user",
      workspaceId: "temporal-day-fence-workspace",
    };
    await memory.remember({
      extractionStrategy: "rules-only",
      locale: "zh-CN",
      messages: [
        {
          content: "我昨天吃了番茄炒蛋。",
          observedAt: "2026-08-12T02:00:00.000Z",
          role: "user",
          timezone: "Asia/Shanghai",
        },
        {
          content: "我今天吃了牛肉面。",
          observedAt: "2026-08-12T04:00:00.000Z",
          role: "user",
          timezone: "Asia/Shanghai",
        },
      ],
      scope: { ...durableScope, sessionId: "teach" },
    });
    const exported = await memory.exportMemory({ scope: durableScope });
    const tomatoId = exported.durable.facts.find(({ content }) =>
      content.includes("番茄炒蛋")
    )?.id;

    const originalDay = await memory.recall({
      locale: "zh-CN",
      query: "我昨天吃了什么？",
      referenceTime: "2026-08-12T05:00:00.000Z",
      scope: { ...durableScope, sessionId: "ask-original-day" },
      strategy: "rules-only",
      timezone: "Asia/Shanghai",
    });
    const nextDay = await memory.recall({
      locale: "zh-CN",
      query: "我昨天吃了什么？",
      referenceTime: "2026-08-13T05:00:00.000Z",
      scope: { ...durableScope, sessionId: "ask-next-day" },
      strategy: "rules-only",
      timezone: "Asia/Shanghai",
    });

    expect(originalDay.facts.map(({ content }) => content)).toEqual([
      "我吃了番茄炒蛋。",
    ]);
    expect(nextDay.facts.map(({ content }) => content)).toEqual([
      "我吃了牛肉面。",
    ]);
    expect(nextDay.metadata.policyApplied).toContain("event_occurrence_fence");
    expect(nextDay.metadata.candidateTraces).toContainEqual(
      expect.objectContaining({
        memoryId: tomatoId,
        returned: false,
        whySuppressed: "event_occurrence_mismatch",
      }),
    );
  });

  it("keeps event identity date-aware while merging same-day evidence", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const durableScope = {
      userId: "temporal-identity-user",
      workspaceId: "temporal-identity-workspace",
    };
    for (const [sessionId, observedAt] of [
      ["day-one-a", "2026-08-12T02:00:00.000Z"],
      ["day-one-b", "2026-08-12T08:00:00.000Z"],
      ["day-two", "2026-08-13T02:00:00.000Z"],
    ] as const) {
      await memory.remember({
        extractionStrategy: "rules-only",
        locale: "zh-CN",
        messages: [
          {
            content: "我昨天吃了番茄炒蛋。",
            observedAt,
            role: "user",
            timezone: "Asia/Shanghai",
          },
        ],
        scope: { ...durableScope, sessionId },
      });
    }

    const exported = await memory.exportMemory({ scope: durableScope });
    expect(exported.durable.facts).toHaveLength(2);
    expect(
      exported.durable.facts.map(({ occurrence }) => occurrence?.start).sort(),
    ).toEqual([
      "2026-08-10T16:00:00.000Z",
      "2026-08-11T16:00:00.000Z",
    ]);
    expect(exported.durable.evidence).toHaveLength(3);
  });

  it("keeps unanchored events undated and out of explicit day answers", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const durableScope = {
      userId: "temporal-undated-user",
      workspaceId: "temporal-undated-workspace",
    };
    await memory.remember({
      extractionStrategy: "rules-only",
      locale: "zh-CN",
      messages: [{ content: "我昨天吃了番茄炒蛋。", role: "user" }],
      scope: { ...durableScope, sessionId: "teach" },
    });
    const exported = await memory.exportMemory({ scope: durableScope });
    const recalled = await memory.recall({
      locale: "zh-CN",
      query: "我昨天吃了什么？",
      referenceTime: "2026-08-12T05:00:00.000Z",
      scope: { ...durableScope, sessionId: "ask" },
      strategy: "rules-only",
      timezone: "Asia/Shanghai",
    });
    const ordinaryRecall = await memory.recall({
      locale: "zh-CN",
      query: "我吃过什么？",
      scope: { ...durableScope, sessionId: "ask-undated" },
      strategy: "rules-only",
    });

    expect(exported.durable.facts).toHaveLength(1);
    expect(exported.durable.facts[0]?.occurrence).toBeUndefined();
    expect(exported.durable.facts[0]?.content).toContain("昨天");
    expect(recalled.facts).toEqual([]);
    expect(ordinaryRecall.facts).toHaveLength(1);
  });

  it("fails closed for explicit date queries when query timezone is unresolved", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = { userId: "temporal-query-without-timezone" };
    await memory.remember({
      extractionStrategy: "rules-only",
      locale: "zh-CN",
      messages: [{
        content: "我昨天吃了番茄炒蛋。",
        observedAt: "2026-08-12T02:00:00.000Z",
        role: "user",
        timezone: "Asia/Shanghai",
      }],
      scope,
    });

    const recalled = await memory.recall({
      locale: "zh-CN",
      query: "我昨天吃了什么？",
      referenceTime: "2026-08-12T03:00:00.000Z",
      scope,
      strategy: "rules-only",
    });
    const context = await memory.buildContext({ recall: recalled });

    expect(recalled.facts).toEqual([]);
    expect(recalled.metadata.policyApplied).toContain(
      "event_occurrence_interval_unresolved",
    );
    expect(context.content).not.toContain("番茄炒蛋");
  });

  it("fails closed when an explicit event date cannot resolve to an interval", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = { userId: "temporal-invalid-query-date" };
    await memory.remember({
      extractionStrategy: "rules-only",
      locale: "en-US",
      messages: [{
        content: "I finished the incident report yesterday.",
        observedAt: "2026-08-12T02:00:00.000Z",
        role: "user",
        timezone: "Asia/Shanghai",
      }],
      scope,
    });

    for (const query of [
      "What did I finish on February 30, 2026?",
      "What did I finish on 2026-02-30?",
    ]) {
      const recalled = await memory.recall({
        locale: "en-US",
        query,
        referenceTime: "2026-08-12T03:00:00.000Z",
        scope,
        strategy: "rules-only",
        timezone: "Asia/Shanghai",
      });

      expect(recalled.facts, query).toEqual([]);
      expect(recalled.metadata.policyApplied, query).toContain(
        "event_occurrence_interval_unresolved",
      );
    }
  });

  it("preserves an authorized occurrence when policy redacts event content", async () => {
    const memory = createGoodMemory({
      policy: {
        redact(candidate) {
          return candidate.kindHint === "fact" && candidate.content.includes("tomato")
            ? { ...candidate, content: "I ate [REDACTED]." }
            : candidate;
        },
      },
      storage: { provider: "memory" },
    });
    const scope = { userId: "temporal-policy-redaction" };

    await memory.remember({
      extractionStrategy: "rules-only",
      locale: "en-US",
      messages: [{
        content: "I ate tomato and eggs yesterday.",
        observedAt: "2026-08-12T02:00:00.000Z",
        role: "user",
        timezone: "Asia/Shanghai",
      }],
      scope,
    });
    const exported = await memory.exportMemory({ scope });

    expect(exported.durable.facts).toEqual([
      expect.objectContaining({
        content: "I ate [REDACTED].",
        occurrence: SHANGHAI_YESTERDAY,
      }),
    ]);
  });

  it("preserves an explicitly invalid calendar date without granting occurrence across every built-in locale", async () => {
    const cases = [
      { locale: "en-US", statement: "I ate tomato and eggs on 2026-02-30." },
      { locale: "zh-CN", statement: "我2026-02-30吃了番茄炒蛋。" },
      { locale: "zh-TW", statement: "我2026-02-30吃了番茄炒蛋。" },
      {
        locale: "fr-FR",
        statement: "J’ai mangé des œufs à la tomate le 2026-02-30.",
      },
      {
        locale: "es-ES",
        statement: "Comí huevos con tomate el 2026-02-30.",
      },
      {
        locale: "ja-JP",
        statement: "私は2026-02-30にトマトと卵を食べました。",
      },
      {
        locale: "ko-KR",
        statement: "저는 2026-02-30에 토마토 달걀을 먹었습니다.",
      },
    ] as const;

    for (const testCase of cases) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: `temporal-invalid-date-${testCase.locale}` };
      const remembered = await memory.remember({
        extractionStrategy: "rules-only",
        locale: testCase.locale,
        messages: [{
          content: testCase.statement,
          observedAt: "2026-08-12T02:00:00.000Z",
          role: "user",
          timezone: "Asia/Shanghai",
        }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });

      expect(remembered, testCase.locale).toMatchObject({
        accepted: 1,
        rejected: 0,
      });
      expect(exported.durable.facts, testCase.locale).toHaveLength(1);
      expect(exported.durable.facts[0]?.content, testCase.locale).toContain(
        "2026-02-30",
      );
      expect(exported.durable.facts[0]?.occurrence, testCase.locale)
        .toBeUndefined();
    }
  });

  it("uses only a pre-existing profile timezone and never retroactively anchors a sibling write", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = { userId: "temporal-profile-timezone-user" };
    await memory.remember({
      extractionStrategy: "rules-only",
      locale: "en-US",
      messages: [
        {
          content: "My timezone is Asia/Shanghai.",
          observedAt: "2026-08-12T01:00:00.000Z",
          role: "user",
        },
        {
          content: "I ate rice yesterday.",
          observedAt: "2026-08-12T02:00:00.000Z",
          role: "user",
        },
      ],
      scope,
    });
    let exported = await memory.exportMemory({ scope });
    expect(exported.durable.facts[0]?.occurrence).toBeUndefined();

    await memory.remember({
      extractionStrategy: "rules-only",
      locale: "en-US",
      messages: [{
        content: "I ate noodles yesterday.",
        observedAt: "2026-08-12T02:00:00.000Z",
        role: "user",
      }],
      scope,
    });
    exported = await memory.exportMemory({ scope });
    expect(exported.durable.facts.find(({ content }) => content.includes("noodles")))
      .toMatchObject({ occurrence: SHANGHAI_YESTERDAY });

    const recalled = await memory.recall({
      locale: "en-US",
      query: "What did I eat yesterday?",
      referenceTime: "2026-08-12T03:00:00.000Z",
      scope,
      strategy: "rules-only",
    });
    expect(recalled.facts.map(({ content }) => content)).toEqual([
      "I ate noodles.",
    ]);
  });

  it("rejects explicitly invalid temporal inputs instead of using the runtime clock", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = { userId: "temporal-invalid-user" };

    expect(
      memory.remember({
        locale: "zh-CN",
        messages: [
          {
            content: "我昨天吃了番茄炒蛋。",
            observedAt: "yesterday",
            role: "user",
            timezone: "Asia/Shanghai",
          },
        ],
        scope,
      }),
    ).rejects.toThrow("messages[0].observedAt");
    expect(
      memory.recall({
        locale: "zh-CN",
        query: "我昨天吃了什么？",
        referenceTime: "not-a-time",
        scope,
        timezone: "Asia/Shanghai",
      }),
    ).rejects.toThrow("referenceTime");
    expect(
      memory.recall({
        locale: "zh-CN",
        query: "我昨天吃了什么？",
        referenceTime: "2026-08-12T05:00:00.000Z",
        scope,
        timezone: "Mars/Olympus_Mons",
      }),
    ).rejects.toThrow("timezone");
  });

  it("does not let custom or assisted extractors self-authorize occurrence", async () => {
    const forgedExpression = {
      kind: "relative" as const,
      offset: -99,
      raw: "invented date",
      unit: "day" as const,
    };
    const custom = createGoodMemory({
      storage: { provider: "memory" },
      testing: {
        extractor: {
          async extract() {
            return {
              candidates: [{
                content: "Rollback owner is Maya.",
                explicitness: "explicit" as const,
                id: "custom-forged-occurrence",
                kindHint: "fact" as const,
                metadata: {
                  category: "event" as const,
                  occurrenceExpression: forgedExpression,
                },
                sourceMessageIndex: 0,
                sourceRole: "user",
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
    });
    await custom.remember({
      locale: "en-US",
      messages: [{
        content: "Maya is the rollback owner.",
        observedAt: "2026-08-12T02:00:00.000Z",
        role: "user",
        timezone: "Asia/Shanghai",
      }],
      scope: { userId: "temporal-custom-authority" },
    });
    const customExport = await custom.exportMemory({
      scope: { userId: "temporal-custom-authority" },
    });

    const assisted = createGoodMemory({
      adapters: {
        assistedExtractor: {
          async extract() {
            return {
              candidates: [{
                content: "I ate tomato and eggs.",
                explicitness: "explicit" as const,
                id: "assisted-forged-occurrence",
                kindHint: "fact" as const,
                metadata: {
                  category: "event" as const,
                  occurrenceExpression: forgedExpression,
                },
                sourceMessageIndex: 0,
                sourceRole: "user",
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
      storage: { provider: "memory" },
    });
    await assisted.remember({
      extractionStrategy: "llm-assisted",
      locale: "en-US",
      messages: [{
        content: "I ate tomato and eggs yesterday.",
        observedAt: "2026-08-12T02:00:00.000Z",
        role: "user",
        timezone: "Asia/Shanghai",
      }],
      scope: { userId: "temporal-assisted-authority" },
    });
    const assistedExport = await assisted.exportMemory({
      scope: { userId: "temporal-assisted-authority" },
    });

    expect(customExport.durable.facts).toEqual([
      expect.objectContaining({ occurrence: undefined }),
    ]);
    expect(assistedExport.durable.facts).toHaveLength(1);
    expect(assistedExport.durable.facts[0]?.occurrence).toEqual(
      SHANGHAI_YESTERDAY,
    );
  });

  it("keeps temporal titles undated and future plans open across public remember", async () => {
    const cases = [
      ["en-US", "I watched the movie Yesterday.", "I will submit the report tomorrow."],
      ["zh-CN", "我看了电影《昨天》。", "我明天会提交报告。"],
      ["zh-TW", "我看了電影《昨天》。", "我明天會提交報告。"],
      ["fr-FR", "J’ai regardé le film « Hier ».", "Je vais soumettre le rapport demain."],
      ["es-ES", "Vi la película « Ayer ».", "Presentaré el informe mañana."],
      ["ja-JP", "私は映画「昨日」を見ました。", "私は明日報告書を提出する予定です。"],
      ["ko-KR", "저는 영화 「어제」를 시청했습니다.", "저는 내일 보고서를 제출할 예정입니다."],
    ] as const;

    for (const [locale, title, futurePlan] of cases) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: `temporal-write-guard-${locale}` };
      const result = await memory.remember({
        extractionStrategy: "rules-only",
        locale,
        messages: [title, futurePlan].map((content) => ({
          content,
          observedAt: "2026-08-12T02:00:00.000Z",
          role: "user" as const,
          timezone: "Asia/Shanghai",
        })),
        scope,
      });
      const exported = await memory.exportMemory({ scope });

      expect(result.accepted, locale).toBeGreaterThanOrEqual(1);
      expect(exported.durable.facts.some(({ occurrence }) =>
        occurrence !== undefined
      ), locale).toBeFalse();
      expect(exported.durable.facts.some(({ factKind }) =>
        factKind === "open_loop"
      ), locale).toBeTrue();
      if (futurePlan === "Presentaré el informe mañana.") {
        expect(exported.durable.facts).toContainEqual(
          expect.objectContaining({
            content: "Presentaré el informe mañana",
            factKind: "open_loop",
            occurrence: undefined,
          }),
        );
      }
    }
  });

  it("uses each built-in locale timezone profile as the relative-event fallback", async () => {
    const cases = [
      ["en-US", "My timezone is America/New_York.", "America/New_York", "I ate tomato and eggs yesterday.", "What did I eat yesterday?"],
      ["zh-CN", "我的时区是Asia/Shanghai。", "Asia/Shanghai", "我昨天吃了番茄炒蛋。", "我昨天吃了什么？"],
      ["zh-TW", "我的時區是Asia/Taipei。", "Asia/Taipei", "我昨天吃了番茄炒蛋。", "我昨天吃了什麼？"],
      ["fr-FR", "Mon fuseau horaire est Europe/Paris.", "Europe/Paris", "J’ai mangé des œufs à la tomate hier.", "Qu’est-ce que j’ai mangé hier ?"],
      ["es-ES", "Mi zona horaria es Europe/Madrid.", "Europe/Madrid", "Comí huevos con tomate ayer.", "¿Qué comí ayer?"],
      ["ja-JP", "私のタイムゾーンはAsia/Tokyoです。", "Asia/Tokyo", "私は昨日トマトと卵を食べました。", "私は昨日何を食べましたか？"],
      ["ko-KR", "제 시간대는 Asia/Seoul입니다.", "Asia/Seoul", "저는 어제 토마토 달걀을 먹었습니다.", "저는 어제 무엇을 먹었습니까?"],
    ] as const;

    for (const [locale, profile, timezone, event, query] of cases) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: "profile-timezone-" + locale };
      await memory.remember({
        extractionStrategy: "rules-only",
        locale,
        messages: [{ content: profile, role: "user" }],
        scope,
      });
      await memory.remember({
        extractionStrategy: "rules-only",
        locale,
        messages: [{
          content: event,
          observedAt: "2026-08-12T02:00:00.000Z",
          role: "user",
        }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });
      const recalled = await memory.recall({
        locale,
        query,
        referenceTime: "2026-08-12T02:00:00.000Z",
        scope,
      });

      expect(exported.durable.profile?.identity.timezone, locale).toBe(timezone);
      expect(exported.durable.facts[0]?.occurrence?.timezone, locale).toBe(timezone);
      expect(recalled.facts, locale).toHaveLength(1);
    }
  });

  it("rejects invalid timezone profiles from every built-in locale", async () => {
    const cases = [
      ["en-US", "My timezone is Mars/Olympus."],
      ["zh-CN", "我的时区是Mars/Olympus。"],
      ["zh-TW", "我的時區是Mars/Olympus。"],
      ["fr-FR", "Mon fuseau horaire est Mars/Olympus."],
      ["es-ES", "Mi zona horaria es Mars/Olympus."],
      ["ja-JP", "私のタイムゾーンはMars/Olympusです。"],
      ["ko-KR", "제 시간대는 Mars/Olympus입니다."],
    ] as const;

    for (const [locale, content] of cases) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: `invalid-profile-timezone-${locale}` };
      const remembered = await memory.remember({
        extractionStrategy: "rules-only",
        locale,
        messages: [{ content, role: "user" }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });

      expect(remembered, locale).toMatchObject({
        accepted: 0,
        events: [expect.objectContaining({
          memoryType: "profile",
          outcome: "rejected",
          reason: "invalid_payload",
        })],
        rejected: 1,
      });
      expect(exported.durable.profile, locale).toBeNull();
    }
  });

  it("writes and queries a native Japanese previous-quarter event", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = { userId: "ja-native-quarter" };
    const remembered = await memory.remember({
      extractionStrategy: "rules-only",
      locale: "ja-JP",
      messages: [{
        content: "私は前四半期に監査を完了しました。",
        observedAt: "2026-08-12T02:00:00.000Z",
        role: "user",
        timezone: "Asia/Tokyo",
      }],
      scope,
    });
    const recalled = await memory.recall({
      locale: "ja-JP",
      query: "前四半期に何を完了しましたか？",
      referenceTime: "2026-08-12T02:00:00.000Z",
      scope,
      timezone: "Asia/Tokyo",
    });

    expect(remembered.accepted).toBe(1);
    expect(recalled.metadata.retrievalTrace?.schemaVersion === 2
      ? recalled.metadata.retrievalTrace.plan.temporalConstraints
      : undefined).toEqual([
      expect.objectContaining({
        kind: "during",
        interval: expect.objectContaining({ precision: "quarter" }),
      }),
    ]);
    expect(recalled.facts).toHaveLength(1);
  });

  it("resolves the English day before yesterday without a before-query collision", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = { userId: "en-day-before-yesterday" };
    await memory.remember({
      extractionStrategy: "rules-only",
      locale: "en-US",
      messages: [{
        content: "I ate tomato and eggs the day before yesterday.",
        observedAt: "2026-08-12T15:29:00.000Z",
        role: "user",
        timezone: "America/New_York",
      }],
      scope,
    });
    const matching = await memory.recall({
      locale: "en-US",
      query: "What did I eat the day before yesterday?",
      referenceTime: "2026-08-12T15:29:00.000Z",
      scope,
      timezone: "America/New_York",
    });
    const adjacent = await memory.recall({
      locale: "en-US",
      query: "What did I eat yesterday?",
      referenceTime: "2026-08-12T15:29:00.000Z",
      scope,
      timezone: "America/New_York",
    });

    const matchingTrace = matching.metadata.retrievalTrace;
    expect(matchingTrace?.schemaVersion === 2
      ? matchingTrace.plan.temporalConstraints
      : undefined).toEqual([expect.objectContaining({ kind: "during" })]);
    expect(matching.facts).toHaveLength(1);
    expect(adjacent.facts).toEqual([]);
  });

  it("preserves and recalls an exact technical instant across language packs", async () => {
    const cases = [
      ["en-US", "I completed deployment at time=2026-08-11T03:04:05Z.", "What did I complete at time=2026-08-11T03:04:05Z?"],
      ["zh-CN", "我在time=2026-08-11T03:04:05Z完成了部署。", "我在time=2026-08-11T03:04:05Z完成了什么？"],
      ["ja-JP", "私はtime=2026-08-11T03:04:05Zに展開を完了しました。", "私はtime=2026-08-11T03:04:05Zに何を完了しましたか？"],
    ] as const;

    for (const [locale, statement, query] of cases) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: "technical-instant-" + locale };
      await memory.remember({
        extractionStrategy: "rules-only",
        locale,
        messages: [{
          content: statement,
          observedAt: "2026-08-12T15:29:00.000Z",
          role: "user",
          timezone: "UTC",
        }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });
      const recalled = await memory.recall({
        locale,
        query,
        referenceTime: "2026-08-12T15:29:00.000Z",
        scope,
        timezone: "UTC",
      });

      expect(exported.durable.facts[0]?.occurrence, locale).toEqual({
        endExclusive: "2026-08-11T03:04:05.001Z",
        precision: "instant",
        start: "2026-08-11T03:04:05.000Z",
        timezone: "UTC",
      });
      expect(recalled.facts, locale).toHaveLength(1);
    }
  });

  it("keeps literal English titles and canonicalizes an instant over sibling modifiers", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = { userId: "english-title-and-instant" };
    const title = await memory.remember({
      extractionStrategy: "rules-only",
      locale: "en-US",
      messages: [{
        content: "I watched the movie Yesterday.",
        observedAt: "2026-08-12T15:29:00.000Z",
        role: "user",
        timezone: "UTC",
      }],
      scope,
    });
    await memory.remember({
      extractionStrategy: "rules-only",
      locale: "en-US",
      messages: [{
        content:
          "I completed deployment yesterday at time=2026-08-11T03:04:05Z.",
        observedAt: "2026-08-12T15:29:00.000Z",
        role: "user",
        timezone: "UTC",
      }],
      scope,
    });
    const exported = await memory.exportMemory({ scope });
    const recalled = await memory.recall({
      locale: "en-US",
      query: "What did I complete at time=2026-08-11T03:04:05Z?",
      referenceTime: "2026-08-12T15:29:00.000Z",
      scope,
      timezone: "UTC",
    });
    const context = await memory.buildContext({ output: "markdown", recall: recalled });

    expect(title.accepted).toBe(1);
    expect(exported.durable.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: "I watched the movie Yesterday.",
        occurrence: undefined,
      }),
      expect.objectContaining({
        content: "I completed deployment.",
        occurrence: {
          endExclusive: "2026-08-11T03:04:05.001Z",
          precision: "instant",
          start: "2026-08-11T03:04:05.000Z",
          timezone: "UTC",
        },
      }),
    ]));
    expect(context.content).toContain(
      "[2026-08-11T03:04:05.000Z, instant, UTC] I completed deployment.",
    );
    expect(context.content).not.toContain("deployment yesterday");
  });

  it("persists structurally completed English and Korean events as dated facts", async () => {
    const cases = [
      ["en-US", "I taught a class yesterday.", "I taught a class."],
      ["en-US", "I slept at the hotel yesterday.", "I slept at the hotel."],
      ["ko-KR", "저는 어제 동료를 도왔습니다.", "저는 동료를 도왔습니다."],
    ] as const;

    for (const [locale, statement, expected] of cases) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: "completed-morphology-" + statement };
      const remembered = await memory.remember({
        extractionStrategy: "rules-only",
        locale,
        messages: [{
          content: statement,
          observedAt: "2026-08-12T15:29:00.000Z",
          role: "user",
          timezone: "America/New_York",
        }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });

      expect(remembered.accepted, statement).toBe(1);
      expect(exported.durable.facts, statement).toEqual([
        expect.objectContaining({
          content: expected,
          occurrence: expect.objectContaining({
            precision: "day",
            timezone: "America/New_York",
          }),
        }),
      ]);
    }
  });
});
