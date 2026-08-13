import { describe, expect, it } from "bun:test";

import {
  createLanguageService,
  createNeutralLanguagePack,
} from "../../src/language";
import type {
  MemoryCandidate,
  MemoryExtractionInput,
  MemoryExtractionResult,
} from "../../src/remember/candidates";
import { createRememberEngine } from "../../src/remember/engine";
import type { RememberEngineConfig } from "../../src/remember/engine";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";
import { createMemoryRepositories } from "../../src/storage/repositories";
import {
  createDeterministicIdGenerator,
  DeterministicClock,
} from "../../src/testing/utils";

function createInterrogativeTestLanguage(
  onAnalyze?: (text: string) => void,
) {
  const neutral = createNeutralLanguagePack();
  return createLanguageService({
    defaultLocale: "xx",
    packs: [{
      ...neutral,
      analyzerVersion: "interrogative-test-v1",
      compatibilityGroup: "xx",
      defaultLocale: "xx",
      detect: () => "distinctive",
      id: "xx-interrogative-test",
      locales: ["xx"],
      splitClauses: (text) => text
        .split("|")
        .map((clause) => clause.trim())
        .filter(Boolean),
      analyzeContent: (text) => {
        onAnalyze?.(text);
        return {
          ...neutral.analyzeContent(text),
          interrogative: text.trim().endsWith("?"),
        };
      },
    }],
  });
}

function createEngine(overrides: Partial<RememberEngineConfig> = {}) {
  const clock = new DeterministicClock("2026-01-01T00:00:00.000Z");
  const documentStore = createInMemoryDocumentStore();
  const repositories = createMemoryRepositories({
    documentStore,
    sessionStore: createInMemorySessionStore(),
  });
  const engine = createRememberEngine({
    createId: createDeterministicIdGenerator("mem"),
    documentStore,
    language: createInterrogativeTestLanguage(),
    now: () => clock.now().toISOString(),
    repositories,
    ...overrides,
  });

  return { engine, repositories };
}

function sourceContents(input: MemoryExtractionInput): string[] {
  return input.messages.map(({ content }) => content);
}

function fabricatedCandidate(
  id: string,
  sourceMessageIndex: number,
): MemoryCandidate {
  return {
    content: `${id} durable value`,
    explicitness: "explicit",
    id,
    kindHint: "fact",
    metadata: { category: "project" },
    sourceMessageIndex,
    sourceRole: "user",
  };
}

describe("remember producer sanitizer", () => {
  it("reuses the source analysis for unchanged single-clause input", async () => {
    const analyzedContents: string[] = [];
    const language = createInterrogativeTestLanguage((text) => {
      analyzedContents.push(text);
    });
    const { engine } = createEngine({
      extractor: {
        async extract() {
          return { candidates: [], ignoredMessageCount: 0 };
        },
      },
      language,
    });

    await engine.extract({
      locale: "xx",
      messages: [{
        content: "The rollout is blocked on approval.",
        role: "user",
      }],
      scope: { userId: "producer-single-analysis" },
    });

    expect(analyzedContents).toEqual([
      "The rollout is blocked on approval.",
    ]);
  });

  it("passes English interrogative nominal assertions to producers unchanged", async () => {
    const producerInputs: string[][] = [];
    const { engine } = createEngine({
      extractor: {
        async extract(input) {
          producerInputs.push(sourceContents(input));
          return { candidates: [], ignoredMessageCount: 0 };
        },
      },
      language: createLanguageService({
        defaultLocale: "en-US",
        detection: "default_only",
      }),
    });
    const content = "What I ate yesterday was pasta.";

    await engine.extract({
      locale: "en-US",
      messages: [{ content, role: "user" }],
      scope: { userId: "producer-english-nominal-clause" },
    });

    expect(producerInputs).toEqual([[content]]);
  });

  it("passes built-in wh-nominal assertions unchanged in every language", async () => {
    const fixtures = [
      ["en-US", "Who owns the service is documented"],
      ["zh-CN", "谁负责这个项目已记录在文档中"],
      ["zh-TW", "誰負責這個專案已記錄在文件中"],
      ["fr-FR", "Pourquoi cela fonctionne est expliqué ici"],
      ["es-ES", "Quién dirige el proyecto está documentado"],
      ["ja-JP", "誰がサービスを担当するかは文書に記録されています。"],
      ["ko-KR", "누가 서비스를 담당하는지는 문서에 기록되어 있습니다."],
    ] as const;

    for (const [locale, content] of fixtures) {
      const producerInputs: string[][] = [];
      const { engine } = createEngine({
        extractor: {
          async extract(input) {
            producerInputs.push(sourceContents(input));
            return { candidates: [], ignoredMessageCount: 0 };
          },
        },
        language: createLanguageService({
          defaultLocale: locale,
          detection: "default_only",
        }),
      });

      await engine.extract({
        locale,
        messages: [{ content, role: "user" }],
        scope: { userId: `producer-nominal-${locale}` },
      });

      expect(producerInputs).toEqual([[content]]);
    }
  });

  it("blocks question-only source indexes for every producer in a mixed batch", async () => {
    const producerInputs = new Map<string, string[]>();
    const extraction = (
      producer: string,
      input: MemoryExtractionInput,
    ): MemoryExtractionResult => {
      producerInputs.set(producer, sourceContents(input));
      return {
        candidates: [
          fabricatedCandidate(`${producer}-question`, 0),
          fabricatedCandidate(`${producer}-statement`, 1),
        ],
        ignoredMessageCount: 0,
      };
    };
    const { engine } = createEngine({
      assistedExtractor: {
        async extract(input) {
          return extraction("assisted", input);
        },
      },
      extractor: {
        async extract(input) {
          return extraction("custom", input);
        },
      },
      remember: {
        profiles: [{
          extractors: [{
            extractor: {
              async extract(input) {
                return extraction("profile-extractor", input);
              },
            },
            id: "test-profile-extractor",
          }],
          id: "test-profile",
          rules: [{
            extract(input) {
              return extraction("profile-rule", input).candidates;
            },
            id: "test-profile-rule",
          }],
        }],
      },
    });

    const result = await engine.extract({
      extractionStrategy: "llm-assisted",
      locale: "xx",
      messages: [
        { content: "What am I working on?", role: "user" },
        { content: "The rollout is blocked on approval.", role: "user" },
      ],
      scope: { userId: "producer-question-batch" },
    });

    expect([...producerInputs.values()]).toEqual([
      ["", "The rollout is blocked on approval."],
      ["", "The rollout is blocked on approval."],
      ["", "The rollout is blocked on approval."],
      ["", "The rollout is blocked on approval."],
    ]);
    expect(result.candidates.map(({ id }) => id)).toEqual([
      "custom-statement",
      "profile-rule-statement",
      "profile-extractor-statement",
      "assisted-statement",
    ]);
  });

  it("passes only assertion clauses from one mixed message to every producer", async () => {
    const producerInputs = new Map<string, string[]>();
    const extraction = (
      producer: string,
      input: MemoryExtractionInput,
    ): MemoryExtractionResult => {
      producerInputs.set(producer, sourceContents(input));
      return {
        candidates: [fabricatedCandidate(producer, 0)],
        ignoredMessageCount: 0,
      };
    };
    const { engine } = createEngine({
      assistedExtractor: {
        async extract(input) {
          return extraction("assisted", input);
        },
      },
      extractor: {
        async extract(input) {
          return extraction("custom", input);
        },
      },
      remember: {
        profiles: [{
          extractors: [{
            extractor: {
              async extract(input) {
                return extraction("profile-extractor", input);
              },
            },
            id: "test-profile-extractor",
          }],
          id: "test-profile",
          rules: [{
            extract(input) {
              return extraction("profile-rule", input).candidates;
            },
            id: "test-profile-rule",
          }],
        }],
      },
    });

    const result = await engine.extract({
      extractionStrategy: "llm-assisted",
      locale: "xx",
      messages: [{
        content: "The rollout is blocked on approval.|What should I do next?",
        role: "user",
      }],
      scope: { userId: "producer-mixed-clause" },
    });

    expect([...producerInputs.values()]).toEqual([
      ["The rollout is blocked on approval."],
      ["The rollout is blocked on approval."],
      ["The rollout is blocked on approval."],
      ["The rollout is blocked on approval."],
    ]);
    expect(result.candidates).toHaveLength(4);
  });

  it("keeps remember-always authority above question abstention", async () => {
    const { engine, repositories } = createEngine({
      assistedExtractor: {
        async extract() {
          throw new Error("question-only input must not reach assisted extraction");
        },
      },
      extractor: {
        async extract() {
          return {
            candidates: [fabricatedCandidate("custom-question", 0)],
            ignoredMessageCount: 0,
          };
        },
      },
    });
    const scope = { userId: "producer-remember-always" };

    const result = await engine.remember({
      annotations: [{
        confirmed: true,
        kindHint: "fact",
        messageIndex: 0,
        metadataPatch: { category: "project" },
        remember: "always",
      }],
      extractionStrategy: "llm-assisted",
      locale: "xx",
      messages: [{ content: "What am I working on?", role: "user" }],
      scope,
    });

    const facts = await repositories.facts.listByScope(scope);
    expect(result.accepted).toBe(1);
    expect(facts.map(({ content }) => content)).toEqual([
      "What am I working on?",
    ]);
  });
});
