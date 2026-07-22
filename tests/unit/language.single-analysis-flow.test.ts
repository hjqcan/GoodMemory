import { describe, expect, it } from "bun:test";

import { createGoodMemory } from "../../src";
import { createFactMemory } from "../../src/domain/records";
import {
  createLanguageService,
  createNeutralLanguagePack,
} from "../../src/language";
import type { LanguagePack, LanguageService } from "../../src/language";
import { createRecallEngine } from "../../src/recall/engine";
import { createRememberEngine } from "../../src/remember/engine";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";
import { createMemoryRepositories } from "../../src/storage/repositories";

function createCountingPack(input: {
  analyzeContentCalls: { value: number };
  analyzeQueryCalls: { value: number };
  defaultLocale: string;
  id: string;
  marker: string;
}): LanguagePack {
  const neutral = createNeutralLanguagePack();
  return {
    ...neutral,
    analyzerVersion: "single-analysis-v1",
    compatibilityGroup: input.id,
    defaultLocale: input.defaultLocale,
    detect: ({ texts }) =>
      texts.some((text) => text.includes(input.marker))
        ? "distinctive"
        : "none",
    id: input.id,
    locales: [input.defaultLocale],
    analyzeContent(text) {
      input.analyzeContentCalls.value += 1;
      return neutral.analyzeContent(text);
    },
    analyzeQuery(text) {
      input.analyzeQueryCalls.value += 1;
      return neutral.analyzeQuery(text);
    },
  };
}

function countLanguageResolution(service: LanguageService): {
  language: LanguageService;
  resolveFromMessagesCalls: { value: number };
  resolveFromTextCalls: { value: number };
} {
  const resolveFromMessagesCalls = { value: 0 };
  const resolveFromTextCalls = { value: 0 };
  return {
    language: {
      ...service,
      resolveFromMessages(input) {
        resolveFromMessagesCalls.value += 1;
        return service.resolveFromMessages(input);
      },
      resolveFromText(input) {
        resolveFromTextCalls.value += 1;
        return service.resolveFromText(input);
      },
    },
    resolveFromMessagesCalls,
    resolveFromTextCalls,
  };
}

describe("request-local language analysis", () => {
  it("keeps the public recall API on one analysis for its primary query", async () => {
    const analyzeContentCalls = { value: 0 };
    const analyzeQueryCalls = { value: 0 };
    const pack = createCountingPack({
      analyzeContentCalls,
      analyzeQueryCalls,
      defaultLocale: "eo",
      id: "xx-public-recall-counting",
      marker: "[EO]",
    });
    const memory = createGoodMemory({
      language: { packs: [pack] },
      retrieval: { recallPlanExecution: true },
      storage: { provider: "memory" },
    });

    await memory.recall({
      query: "[EO] primary recall query",
      scope: { userId: "public-recall-user" },
    });

    expect(analyzeQueryCalls.value).toBe(1);
  });

  it("analyzes each decomposed query once while reusing the parent language context", async () => {
    const analyzeContentCalls = { value: 0 };
    const analyzeQueryCalls = { value: 0 };
    const countingPack = createCountingPack({
      analyzeContentCalls,
      analyzeQueryCalls,
      defaultLocale: "eo",
      id: "xx-decomposed-recall-counting",
      marker: "[EO]",
    });
    const pack: LanguagePack = {
      ...countingPack,
      decomposeQuery: () => [
        "[EO] first facet detail",
        "[EO] second facet detail",
      ],
    };
    const memory = createGoodMemory({
      language: { packs: [pack] },
      retrieval: { recallPlanExecution: true },
      storage: { provider: "memory" },
    });

    const recalled = await memory.recall({
      query: "[EO] compound recall query",
      scope: { userId: "public-decomposed-user" },
    });

    expect(recalled.metadata.retrievalTrace).toMatchObject({
      schemaVersion: 2,
      subQueries: [
        "[EO] first facet detail",
        "[EO] second facet detail",
      ],
    });
    expect(analyzeQueryCalls.value).toBe(3);
  });

  it("keeps the public remember API on the same request-local source analysis", async () => {
    const analyzeContentCalls = { value: 0 };
    const analyzeQueryCalls = { value: 0 };
    const pack = createCountingPack({
      analyzeContentCalls,
      analyzeQueryCalls,
      defaultLocale: "eo",
      id: "xx-public-remember-counting",
      marker: "[EO]",
    });
    const memory = createGoodMemory({
      language: { packs: [pack] },
      storage: { provider: "memory" },
    });

    await memory.remember({
      annotations: [{ kindHint: "fact", messageIndex: 0, remember: "always" }],
      locale: "eo",
      messages: [{ content: "[EO] durable source", role: "user" }],
      scope: { userId: "public-user" },
    });

    expect(analyzeContentCalls.value).toBe(1);
  });

  it("passes the request-local source analysis into deterministic candidate extraction", async () => {
    const analyzeContentCalls = { value: 0 };
    const analyzeQueryCalls = { value: 0 };
    let receivedAnalysis = false;
    const countingPack = createCountingPack({
      analyzeContentCalls,
      analyzeQueryCalls,
      defaultLocale: "eo",
      id: "xx-deterministic-extraction-counting",
      marker: "[EO]",
    });
    const pack: LanguagePack = {
      ...countingPack,
      extractCandidates(input) {
        receivedAnalysis = input.messages[0]?.analysis !== undefined;
        return [];
      },
    };
    const memory = createGoodMemory({
      language: { packs: [pack] },
      storage: { provider: "memory" },
    });

    await memory.remember({
      locale: "eo",
      messages: [{ content: "[EO] durable source", role: "user" }],
      scope: { userId: "public-extraction-user" },
    });

    expect(receivedAnalysis).toBe(true);
    expect(analyzeContentCalls.value).toBe(1);
  });

  it("resolves and analyzes one recall query exactly once across planning, routing, selection, scoring, and verification", async () => {
    const analyzeContentCalls = { value: 0 };
    const analyzeQueryCalls = { value: 0 };
    const pack = createCountingPack({
      analyzeContentCalls,
      analyzeQueryCalls,
      defaultLocale: "eo",
      id: "xx-recall-counting",
      marker: "[EO]",
    });
    const counted = countLanguageResolution(createLanguageService({
      packs: [pack],
    }));
    const documentStore = createInMemoryDocumentStore();
    const runtime = createInMemorySessionStore();
    const repositories = createMemoryRepositories({ documentStore, sessionStore: runtime });
    await repositories.facts.add(createFactMemory({
      category: "project",
      content: "[EO] Atlas rollout state",
      createdAt: "2026-07-01T00:00:00.000Z",
      id: "fact-atlas",
      source: {
        extractedAt: "2026-07-01T00:00:00.000Z",
        languagePackId: pack.id,
        languagePackVersion: pack.analyzerVersion,
        locale: pack.defaultLocale,
        localeSource: "detected",
        method: "explicit",
      },
      updatedAt: "2026-07-01T00:00:00.000Z",
      userId: "user-1",
    }));
    const engine = createRecallEngine({
      language: counted.language,
      now: () => Date.parse("2026-07-21T00:00:00.000Z"),
      repositories,
      runtime,
    });

    await engine.recall({
      query: "[EO] Atlas rollout state",
      scope: { userId: "user-1" },
    });

    expect(counted.resolveFromMessagesCalls.value).toBe(0);
    expect(counted.resolveFromTextCalls.value).toBe(1);
    expect(analyzeQueryCalls.value).toBe(1);
  });

  it("resolves and analyzes each remember source message once without collapsing a mixed-language batch", async () => {
    const firstContentCalls = { value: 0 };
    const firstQueryCalls = { value: 0 };
    const secondContentCalls = { value: 0 };
    const secondQueryCalls = { value: 0 };
    const firstPack = createCountingPack({
      analyzeContentCalls: firstContentCalls,
      analyzeQueryCalls: firstQueryCalls,
      defaultLocale: "eo",
      id: "xx-remember-first",
      marker: "[EO]",
    });
    const secondPack = createCountingPack({
      analyzeContentCalls: secondContentCalls,
      analyzeQueryCalls: secondQueryCalls,
      defaultLocale: "la",
      id: "xx-remember-second",
      marker: "[LA]",
    });
    const counted = countLanguageResolution(createLanguageService({
      packs: [firstPack, secondPack],
    }));
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({ documentStore, sessionStore });
    const engine = createRememberEngine({
      createId: (() => {
        let id = 0;
        return () => `memory-${++id}`;
      })(),
      documentStore,
      extractor: {
        async extract() {
          return {
            candidates: [
              {
                content: "[EO] first durable state",
                explicitness: "explicit",
                id: "first-a",
                kindHint: "fact",
                metadata: { category: "project" },
                sourceMessageIndex: 0,
                sourceRole: "user",
              },
              {
                content: "[EO] second durable state",
                explicitness: "explicit",
                id: "first-b",
                kindHint: "fact",
                metadata: { category: "project" },
                sourceMessageIndex: 0,
                sourceRole: "user",
              },
              {
                content: "[LA] secundus status durabilis",
                explicitness: "explicit",
                id: "second-a",
                kindHint: "fact",
                metadata: { category: "project" },
                sourceMessageIndex: 1,
                sourceRole: "user",
              },
              {
                content: "[LA] alter status durabilis",
                explicitness: "explicit",
                id: "second-b",
                kindHint: "fact",
                metadata: { category: "project" },
                sourceMessageIndex: 1,
                sourceRole: "user",
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
      language: counted.language,
      now: () => "2026-07-21T00:00:00.000Z",
      repositories,
    });

    await engine.remember({
      extractionStrategy: "rules-only",
      messages: [
        { content: "[EO] source message", role: "user" },
        { content: "[LA] source message", role: "user" },
      ],
      scope: { userId: "user-2" },
    });

    const facts = await repositories.facts.listByUser("user-2");
    expect(new Set(facts.map((fact) => fact.source.locale))).toEqual(
      new Set(["eo", "la"]),
    );
    expect(counted.resolveFromMessagesCalls.value).toBe(0);
    expect(counted.resolveFromTextCalls.value).toBe(2);
    expect(firstContentCalls.value).toBe(1);
    expect(secondContentCalls.value).toBe(1);
  });
});
