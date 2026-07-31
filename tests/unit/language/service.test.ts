import { describe, expect, it } from "bun:test";
import {
  createChineseLanguagePack,
  createEnglishLanguagePack,
  createJapaneseLanguagePack,
  createLanguageService,
  createNeutralLanguagePack,
} from "../../../src/language";
import type {
  LanguagePack,
  LanguageQueryAnalysis,
} from "../../../src/language";

function emptyQueryAnalysis(): LanguageQueryAnalysis {
  return {
    actionDriving: false,
    after: false,
    aggregateCount: false,
    answerComposition: false,
    assistantEvidenceRecall: false,
    before: false,
    blocker: false,
    change: false,
    continuation: false,
    current: false,
    directFactualLookup: false,
    exhaustiveList: false,
    factConfirmation: false,
    focus: false,
    guidanceSeeking: false,
    history: false,
    openLoop: false,
    procedural: false,
    projectState: false,
    recommendationStyle: false,
    relation: false,
    referenceSeeking: false,
    role: false,
    userGroundedEventOrder: false,
  };
}

describe("language service", () => {
  it("prefers explicit locale over detection", () => {
    const service = createLanguageService({
      defaultLocale: "en-US",
    });

    const resolved = service.resolveFromText({
      locale: "zh-CN",
      text: "Please keep answers concise.",
    });

    expect(resolved.locale).toBe("zh-CN");
    expect(resolved.localeSource).toBe("explicit");
    expect(resolved.languagePackId).toBe("zh-Hans");
  });

  it("detects Chinese automatically when no locale is provided", () => {
    const service = createLanguageService();

    const resolved = service.resolveFromText({
      text: "请记住我喜欢中文回复。",
    });

    expect(resolved.locale).toBe("zh-CN");
    expect(resolved.localeSource).toBe("detected");
    expect(resolved.languagePackId).toBe("zh-Hans");
  });

  it("keeps Chinese locale when the sentence mixes Han text with ASCII paths", () => {
    const service = createLanguageService();

    const resolved = service.resolveFromText({
      text: "以docs/runbook.md为准。",
    });

    expect(resolved.locale).toBe("zh-CN");
    expect(resolved.languagePackId).toBe("zh-Hans");
  });

  it("keeps built-in CJK detection signals disjoint and script-aware", () => {
    const simplified = createChineseLanguagePack("Hans");
    const traditional = createChineseLanguagePack("Hant");
    const japanese = createJapaneseLanguagePack();
    const simplifiedQuery = "应该参考哪份文档？";
    const traditionalQuery = "應該參考哪份文檔？";

    expect(japanese.detect({ texts: ["田中東京大学"] })).toBe("compatible");
    expect(japanese.detect({ texts: ["現在の状態"] })).toBe("distinctive");
    expect(simplified.detect({ texts: [simplifiedQuery] })).toBe("distinctive");
    expect(traditional.detect({ texts: [simplifiedQuery] })).toBe("compatible");
    expect(traditional.detect({ texts: [traditionalQuery] })).toBe("distinctive");
    expect(simplified.detect({ texts: [traditionalQuery] })).toBe("compatible");
  });

  it("uses a Chinese default for Han-only Chinese without script signals", () => {
    const service = createLanguageService({ defaultLocale: "zh-CN" });

    const resolved = service.resolveFromText({
      text: "知识图谱",
    });

    expect(resolved).toMatchObject({
      languagePackId: "zh-Hans",
      locale: "zh-CN",
      localeSource: "default",
    });
  });

  it("uses Chinese grammar to resolve common-script Han text", () => {
    expect(createLanguageService().resolveFromText({
      text: "我在北京工作。我是工程主管。",
    })).toMatchObject({
      languagePackId: "zh-Hans",
      locale: "zh-CN",
      localeSource: "detected",
    });

    expect(createLanguageService({
      defaultLocale: "zh-TW",
    }).resolveFromText({
      text: "我在北京工作。我是工程主管。",
    })).toMatchObject({
      languagePackId: "zh-Hant",
      locale: "zh-Hant",
      localeSource: "detected",
    });
  });

  it("resolves Traditional Chinese and Japanese without central heuristics", () => {
    const service = createLanguageService();

    const traditional = service.resolveFromText({
      text: "請記住我偏好繁體中文回覆。",
    });
    expect(traditional.locale).toBe("zh-Hant");
    expect(traditional.languagePackId).toBe("zh-Hant");
    expect(traditional.localeSource).toBe("detected");

    const japanese = service.resolveFromText({
      text: "現在のブロッカーは何ですか？",
    });
    expect(japanese.locale).toBe("ja-JP");
    expect(japanese.languagePackId).toBe("ja");
    expect(japanese.localeSource).toBe("detected");
  });

  it("resolves Korean, French, and Spanish through their built-in packs", () => {
    const service = createLanguageService();

    expect(service.resolveFromText({ text: "현재 장애 요인은 무엇인가요?" }))
      .toMatchObject({
        languagePackId: "ko",
        locale: "ko-KR",
        localeSource: "detected",
      });
    expect(service.resolveFromText({ text: "Quel est le blocage actuel ?" }))
      .toMatchObject({
        languagePackId: "fr",
        locale: "fr-FR",
        localeSource: "detected",
      });
    expect(service.resolveFromText({ text: "¿Cuál es el bloqueo actual?" }))
      .toMatchObject({
        languagePackId: "es",
        locale: "es-ES",
        localeSource: "detected",
      });
    expect(service.resolveFromText({ locale: "fr-CA", text: "Atlas" }))
      .toMatchObject({ languagePackId: "fr", locale: "fr-CA" });
  });

  it("uses the configured default for unmarked Latin ambiguity", () => {
    expect(
      createLanguageService({ defaultLocale: "es-ES" }).resolveFromText({
        text: "Atlas 42",
      }),
    ).toMatchObject({
      languagePackId: "es",
      locale: "es-ES",
      localeSource: "default",
    });
  });

  it("recognizes plural English project-state questions", () => {
    const service = createLanguageService();
    const context = service.resolveFromText({
      locale: "en-US",
      text: "How many projects is Morgan currently leading?",
    });

    expect(
      service.analyzeQuery(
        "How many projects is Morgan currently leading?",
        context,
      ).projectState,
    ).toBe(true);
  });

  it("extracts English temporal operands only from factual time relations", () => {
    const english = createEnglishLanguagePack();
    const analyze = (query: string) =>
      english.analyzeQuery(query).temporalOperands ?? [];

    expect(analyze(
      "Which event happened earlier, the laptop repair or the router replacement?",
    )).toEqual(["the laptop repair", "the router replacement"]);
    expect(analyze(
      "Who became a parent first, Alice Cooper or Bob Dylan?",
    )).toEqual(["Alice Cooper", "Bob Dylan"]);
    expect(analyze(
      "Did the bake sale happen before or after the charity marathon?",
    )).toEqual(["the bake sale", "the charity marathon"]);
    expect(analyze(
      "How many days had passed since the product launch when the first renewal arrived?",
    )).toEqual(["the product launch", "the first renewal arrived"]);

    for (const query of [
      "Which task should I do first, deploy backend or update docs?",
      "What is the relationship between relational database and embedded database?",
      "How long is the bridge between Staten Island and Brooklyn?",
      "How far is it between Staten Island and Brooklyn?",
      "How many chairs stood between Alice Cooper and Bob Dylan?",
      "How many charity events happened before the marathon?",
      "How many days are in a leap year?",
    ]) {
      expect(analyze(query), query).toEqual([]);
    }
    expect(
      english.analyzeQuery(
        "How long is the bridge between Staten Island and Brooklyn?",
      ).temporalInterval,
    ).toBe(false);
  });

  it("uses the configured default for Han-only ambiguous text", () => {
    const service = createLanguageService({
      defaultLocale: "ja-JP",
    });

    const resolved = service.resolveFromText({
      text: "田中東京大学",
    });

    expect(resolved.locale).toBe("ja-JP");
    expect(resolved.localeSource).toBe("default");
    expect(resolved.languagePackId).toBe("ja");
  });

  it("keeps Japanese as the default for ambiguous shared Han vocabulary", () => {
    const service = createLanguageService({ defaultLocale: "ja-JP" });

    for (const text of ["現在", "項目"]) {
      expect(service.resolveFromText({ text })).toMatchObject({
        languagePackId: "ja",
        locale: "ja-JP",
        localeSource: "default",
      });
    }
  });

  it("does not split sentences or query facets inside paths and decimals", () => {
    const service = createLanguageService();
    const sentence = "Use docs/runbook.md for release 1.2. Then verify.";
    const resolved = service.resolveFromText({
      locale: "en-US",
      text: sentence,
    });

    expect(service.splitSentences(sentence, resolved)).toEqual([
      "Use docs/runbook.md for release 1.2.",
      "Then verify.",
    ]);
    expect(
      service.decomposeQuery(
        "What is in docs/runbook.md? What changed in release 1.2?",
        resolved,
      ),
    ).toEqual([
      "What is in docs/runbook.md",
      "What changed in release 1.2",
    ]);
  });

  it("maps explicit Chinese region locales to the correct script pack", () => {
    const service = createLanguageService();

    expect(service.resolveFromText({ locale: "zh-TW", text: "中文" })).toMatchObject({
      languagePackId: "zh-Hant",
      locale: "zh-TW",
      localeSource: "explicit",
    });
    expect(service.resolveFromText({ locale: "zh-SG", text: "中文" })).toMatchObject({
      languagePackId: "zh-Hans",
      locale: "zh-SG",
      localeSource: "explicit",
    });
  });

  it("uses neutral semantics for unsupported locales instead of English", () => {
    const service = createLanguageService();
    const resolved = service.resolveFromText({
      locale: "de-DE",
      text: "What is the current blocker?",
    });

    expect(resolved.languagePackId).toBe("neutral");
    expect(service.isBlockerQuery("What is the current blocker?", resolved)).toBe(
      false,
    );
  });

  it("keeps a custom neutral fallback identity consistent with its manifest", () => {
    const neutral: LanguagePack = {
      ...createNeutralLanguagePack(),
      analyzerVersion: "2-custom-neutral",
    };
    const service = createLanguageService({ packs: [neutral] });
    const resolved = service.resolveFromText({
      locale: "de-DE",
      text: "mémoire durable",
    });

    expect(resolved).toMatchObject({
      languagePackId: "neutral",
      languagePackVersion: "2-custom-neutral",
    });
    expect(service.analyzerVersion(resolved)).toBe("2-custom-neutral");
    expect(
      service.getAnalyzerManifest().packs.filter(({ id }) => id === "neutral"),
    ).toEqual([
      expect.objectContaining({ analyzerVersion: "2-custom-neutral" }),
    ]);
  });

  it("keeps generic precondition words out of English overlap while retaining technical search terms", () => {
    const service = createLanguageService();
    const resolved = service.resolveFromText({
      locale: "en-US",
      text: "Before publishing docs, run smoke verification.",
    });
    const options = { excludeStopwords: true };

    expect(
      service.tokenOverlap(
        "Before publishing docs, run smoke verification.",
        "deploy production Before deleting the old release",
        resolved,
        options,
      ),
    ).toBe(0);
    expect(
      service.buildSearchTerms(
        "What happened the day before the appointment?",
        resolved,
      ),
    ).toContain("before");
    expect(
      service.tokenOverlap(
        "What happened before I went to bed?",
        "The night before bed was restless.",
        resolved,
        options,
      ),
    ).toBeGreaterThan(0);
    expect(service.buildSearchTerms("Never use npm.", resolved)).toContain("npm");
    expect(service.buildSearchTerms("Never use bun.", resolved)).toContain("bun");
  });

  it("keeps English coordinating conjunction boundaries in the English pack", () => {
    expect(
      createEnglishLanguagePack().splitClauses(
        "Never use npm, but use bun instead.",
      ),
    ).toEqual([
      "Never use npm",
      "use bun instead.",
    ]);
  });

  it("extracts concise explicit English procedural directives", () => {
    const service = createLanguageService();
    const directives = [
      { content: "Never use npm.", feedbackKind: "dont" },
      { content: "Do not use npm.", feedbackKind: "dont" },
      { content: "Please use bun.", feedbackKind: "do" },
      {
        content: "Remember to run smoke verification.",
        feedbackKind: "do",
      },
    ] as const;

    for (const directive of directives) {
      const resolved = service.resolveFromText({ text: directive.content });
      let candidateCounter = 0;
      const candidates = service.extractCandidates(
        {
          locale: resolved.locale,
          messages: [{ content: directive.content, role: "user" }],
          nextId: () => `concise-directive-${++candidateCounter}`,
        },
        resolved,
      );

      expect(candidates).toEqual([
        expect.objectContaining({
          content: directive.content,
          kindHint: "feedback",
          metadata: expect.objectContaining({
            feedbackKind: directive.feedbackKind,
          }),
        }),
      ]);
    }

    const neverMind = service.resolveFromText({ text: "Never mind." });
    expect(service.extractCandidates(
      {
        locale: neverMind.locale,
        messages: [{ content: "Never mind.", role: "user" }],
        nextId: () => "never-mind",
      },
      neverMind,
    )).toEqual([]);
  });

  it("maps Japanese project signals to language-independent fact kinds", () => {
    const service = createLanguageService();
    const context = service.resolveFromText({ locale: "ja-JP", text: "現在" });
    let id = 0;
    const candidates = service.extractCandidates(
      {
        locale: context.locale,
        messages: [
          { role: "user", content: "覚えておいて、現在のブロッカーは承認待ちです。" },
          { role: "user", content: "覚えておいて、未完了の対応は監査ログです。" },
          { role: "user", content: "覚えておいて、現在は移行作業に集中しています。" },
          { role: "user", content: "覚えておいて、プロジェクトは検証段階です。" },
        ],
        nextId: () => `ja-fact-${++id}`,
      },
      context,
    );

    expect(
      candidates
        .filter(({ kindHint }) => kindHint === "fact")
        .map(({ metadata }) => metadata?.factKind),
    ).toEqual(["blocker", "open_loop", "focus_update", "project_state"]);
  });

  it("exposes a stable, sorted analyzer manifest for persistent projections", () => {
    const service = createLanguageService({
      defaultLocale: "zh-TW",
      detection: "default_only",
    });

    const manifest = service.getAnalyzerManifest();

    expect(manifest).toMatchObject({
      defaultLocale: "zh-TW",
      detection: "default_only",
      persistable: true,
      resolutionOrder: [
        "en",
        "zh-Hans",
        "zh-Hant",
        "ja",
        "ko",
        "fr",
        "es",
        "neutral",
      ],
      resolverVersion: "3",
      schemaVersion: 1,
    });
    expect(manifest.packs.map(({ id }) => id)).toEqual([
      "en",
      "es",
      "fr",
      "ja",
      "ko",
      "neutral",
      "zh-Hans",
      "zh-Hant",
    ]);
    expect(manifest.packs.find(({ id }) => id === "en")).toMatchObject({
      analyzerVersion: "13",
      apiVersion: 1,
      compatibilityGroup: "en",
      defaultLocale: "en-US",
    });
    expect(
      manifest.packs.find(({ id }) => id === "zh-Hant"),
    ).toMatchObject({
      analyzerVersion: "12-directive-pointer-boundary",
      apiVersion: 1,
      compatibilityGroup: "zh-Hant",
      defaultLocale: "zh-Hant",
      locales: ["zh-Hant", "zh-HK", "zh-MO", "zh-TW"],
    });
    expect(JSON.stringify(service.getAnalyzerManifest())).toBe(
      JSON.stringify(manifest),
    );
  });

  it("fails persistent manifest eligibility for an unversioned custom detector", () => {
    const detector = () => "ja-JP";

    expect(
      createLanguageService({ detector }).getAnalyzerManifest(),
    ).toMatchObject({ persistable: false });
    expect(
      createLanguageService({
        detector,
        detectorVersion: "host-locale-router-v2",
      }).getAnalyzerManifest(),
    ).toMatchObject({
      detectorVersion: "host-locale-router-v2",
      persistable: true,
    });
    expect(
      createLanguageService({
        detection: "default_only",
        detector,
      }).getAnalyzerManifest(),
    ).toMatchObject({ persistable: true });
  });

  it("snapshots detector identity together with detector behavior", () => {
    const config = {
      detector: () => "ja-JP",
      detectorVersion: "detector-v1",
    };
    const service = createLanguageService(config);
    const originalManifest = JSON.stringify(service.getAnalyzerManifest());

    config.detector = () => "zh-TW";
    config.detectorVersion = "detector-v2";

    expect(service.resolveFromText({ text: "ambiguous" })).toMatchObject({
      languagePackId: "ja",
      locale: "ja-JP",
    });
    expect(service.getAnalyzerManifest().detectorVersion).toBe("detector-v1");
    expect(JSON.stringify(service.getAnalyzerManifest())).toBe(originalManifest);
  });

  it("canonicalizes custom pack locales for both runtime and manifest", () => {
    const pack: LanguagePack = {
      ...createNeutralLanguagePack(),
      analyzerVersion: "custom-v1",
      compatibilityGroup: "eo",
      defaultLocale: "eo-latn-us",
      detect: () => "distinctive",
      id: "eo-test",
      locales: ["eo-latn-us"],
    };
    const service = createLanguageService({ packs: [pack] });

    expect(service.resolveFromText({ text: "saluton" })).toMatchObject({
      languagePackId: "eo-test",
      locale: "eo-Latn-US",
    });
    expect(
      service.getAnalyzerManifest().packs.find(({ id }) => id === "eo-test"),
    ).toMatchObject({
      defaultLocale: "eo-Latn-US",
      locales: ["eo-Latn-US"],
    });
  });

  it("rejects empty custom pack identity instead of proving it as und", () => {
    expect(() =>
      createLanguageService({
        packs: [{
          ...createNeutralLanguagePack(),
          defaultLocale: " ",
          id: "empty-default-locale",
          locales: ["eo"],
        }],
      })
    ).toThrow("defaultLocale");
  });

  it("rejects custom pack locales shadowed by the final registry order", () => {
    expect(() =>
      createLanguageService({
        packs: [{
          ...createNeutralLanguagePack(),
          compatibilityGroup: "ja-region",
          defaultLocale: "ja-JP",
          id: "ja-region",
          locales: ["ja-JP"],
        }],
      })
    ).toThrow("ja-region");
  });

  it("falls back to the configured default when multiple packs detect the same text", () => {
    const english = createEnglishLanguagePack();
    const service = createLanguageService({
      packs: [
        {
          ...english,
          id: "test-it",
          locales: ["it-IT"],
          defaultLocale: "it-IT",
          compatibilityGroup: "test-romance",
          detect: () => "distinctive",
        },
        {
          ...english,
          id: "test-de",
          locales: ["de-DE"],
          defaultLocale: "de-DE",
          compatibilityGroup: "test-romance",
          detect: () => "distinctive",
        },
      ],
    });

    expect(service.resolveFromText({ text: "ambiguous" })).toMatchObject({
      languagePackId: "en",
      locale: "en-US",
      localeSource: "default",
    });
  });

  it("deduplicates and caps search terms at the service boundary", () => {
    const english = createEnglishLanguagePack();
    const service = createLanguageService({
      packs: [{
        ...english,
        buildSearchTerms: () => Array.from(
          { length: 300 },
          (_, index) => `term-${index % 200}`,
        ),
      }],
    });
    const context = service.resolveFromText({ locale: "en-US", text: "query" });

    expect(service.buildSearchTerms("query", context)).toEqual(
      Array.from({ length: 128 }, (_, index) => `term-${index}`),
    );
  });

  it("rejects a pack default locale that does not route back to that pack", () => {
    expect(() =>
      createLanguageService({
        packs: [{
          ...createNeutralLanguagePack(),
          compatibilityGroup: "eo",
          defaultLocale: "fr-FR",
          id: "eo-test",
          locales: ["eo"],
        }],
      })
    ).toThrow("eo-test");
  });

  it("rejects built-in overrides that drop required locale ownership", () => {
    expect(() =>
      createLanguageService({
        packs: [{
          ...createNeutralLanguagePack(),
          compatibilityGroup: "zh",
          defaultLocale: "xx",
          id: "zh-Hans",
          locales: ["xx"],
        }],
      })
    ).toThrow("zh-Hans");
  });

  it("rejects malformed required locales before exposing a manifest", () => {
    expect(() => createLanguageService({ defaultLocale: "also_bad" })).toThrow(
      "defaultLocale",
    );
    expect(() =>
      createLanguageService({
        packs: [{
          ...createNeutralLanguagePack(),
          defaultLocale: "not a locale",
          id: "invalid-locale",
          locales: ["not a locale"],
        }],
      })
    ).toThrow("invalid-locale");
  });

  it("registers a complete custom pack without changing the service", () => {
    const pack: LanguagePack = {
      analyzerVersion: "1",
      apiVersion: 1,
      compatibilityGroup: "xx",
      defaultLocale: "xx-Test",
      detect({ texts }) {
        return texts.some((text) => text.includes("zor"))
          ? "distinctive"
          : "none";
      },
      id: "xx-test",
      locales: ["xx-Test"],
      analyzeBehavioralRule() {
        return {
          firstActionName: undefined,
          formatRule: false,
          generalRule: false,
          negativeRule: false,
        };
      },
      analyzeContent() {
        return {
          assistantAcknowledgement: false,
          assistantContinuity: false,
          blockerFact: false,
          correctionCue: false,
          durableCue: false,
          factPolarity: "unknown",
          feedbackKind: "do",
          focusFact: false,
          openLoopFact: false,
          personalEvidence: false,
          preferenceEvidence: false,
          projectStateFact: false,
          roleFact: false,
          sensitiveCredential: false,
          unresolved: false,
        };
      },
      analyzeQuery(text) {
        return {
          ...emptyQueryAnalysis(),
          blocker: text.includes("zor"),
        };
      },
      buildSearchTerms(text) {
        return text.toLowerCase().split(/\s+/u).filter(Boolean);
      },
      decomposeQuery() {
        return [];
      },
      extractCandidates() {
        return [];
      },
      extractEntityMentions() {
        return [];
      },
      matchesEntityAlias(query, alias) {
        return query.toLowerCase().includes(alias.toLowerCase());
      },
      acceptsEntityCandidate() {
        return true;
      },
      normalizeForEquality(text) {
        return text.toLowerCase();
      },
      parseTemporalExpressions() {
        return [];
      },
      render({ key }) {
        return key;
      },
      splitClauses(text) {
        return [text];
      },
      splitSentences(text) {
        return [text];
      },
      tokenizeForScoring(text) {
        return text.toLowerCase().split(/\s+/u).filter(Boolean);
      },
    };
    const service = createLanguageService({ packs: [pack] });
    const resolved = service.resolveFromText({ text: "zor blocker" });

    expect(resolved.languagePackId).toBe("xx-test");
    expect(service.isBlockerQuery("zor blocker", resolved)).toBe(true);
    expect(service.getAnalyzerManifest().resolutionOrder).toEqual([
      "en",
      "zh-Hans",
      "zh-Hant",
      "ja",
      "ko",
      "fr",
      "es",
      "neutral",
      "xx-test",
    ]);
  });

  it("supports custom language packs whose methods live on a prototype", () => {
    const neutral = createNeutralLanguagePack();
    class PrototypeLanguagePack {
      readonly analyzerVersion = "prototype-v1";
      readonly apiVersion = 1 as const;
      readonly compatibilityGroup = "eo";
      readonly defaultLocale = "eo";
      readonly id = "prototype-pack";
      readonly locales = ["eo"];
    }
    interface PrototypeLanguagePack extends LanguagePack {}
    Object.assign(PrototypeLanguagePack.prototype, neutral, {
      analyzeQuery(text: string) {
        return {
          ...emptyQueryAnalysis(),
          blocker: text.includes("blokita"),
        };
      },
      detect: () => "distinctive",
    });

    const service = createLanguageService({
      packs: [new PrototypeLanguagePack()],
    });
    const context = service.resolveFromText({ text: "blokita" });

    expect(context.languagePackId).toBe("prototype-pack");
    expect(service.isBlockerQuery("blokita", context)).toBe(true);
  });

  it("runs captured pack methods against the frozen analyzer snapshot", () => {
    const pack: LanguagePack = {
      ...createNeutralLanguagePack(),
      analyzerVersion: "snapshot-v1",
      compatibilityGroup: "eo",
      defaultLocale: "eo",
      id: "snapshot-pack",
      locales: ["eo"],
      normalizeForEquality(text) {
        return `${this.analyzerVersion}:${text}`;
      },
    };
    const service = createLanguageService({ packs: [pack] });

    (pack as { analyzerVersion: string }).analyzerVersion = "snapshot-v2";

    expect(service.normalizeForEquality("value", "eo")).toBe(
      "snapshot-v1:value",
    );
    expect(
      service.getAnalyzerManifest().packs.find(({ id }) => id === "snapshot-pack")
        ?.analyzerVersion,
    ).toBe("snapshot-v1");
  });

  it("captures enumerable custom pack state used by a method", () => {
    const pack = {
      ...createNeutralLanguagePack(),
      analyzerVersion: "state-v1",
      compatibilityGroup: "eo",
      defaultLocale: "eo",
      id: "state-pack",
      locales: ["eo"],
      normalizeForEquality(text: string) {
        return `${this.prefix}:${text}`;
      },
      prefix: "stable",
    };
    const service = createLanguageService({ packs: [pack] });

    pack.prefix = "mutated";

    expect(service.normalizeForEquality("value", "eo")).toBe("stable:value");
  });

  it("keeps Chinese content during normalization and tokenization", () => {
    const service = createLanguageService();
    const resolved = service.resolveFromText({
      text: "请记住我喜欢中文回复。",
    });

    expect(service.normalizeForEquality("请记住我喜欢中文回复。", resolved)).toBe(
      "请记住我喜欢中文回复",
    );
    expect(service.tokenize("请记住我喜欢中文回复。", resolved)).not.toHaveLength(0);
  });

  it("delegates entity alias matching to the active language pack", () => {
    const service = createLanguageService();

    expect(
      service.matchesEntityAlias(
        "資料庫移行の現在の状態は？",
        "資料庫移行",
        "ja-JP",
      ),
    ).toBe(true);
    expect(
      service.matchesEntityAlias(
        "What changed for Atlas?",
        "art",
        "en-US",
      ),
    ).toBe(false);
  });

  it("keeps localized recommendation and source-of-truth semantics inside packs", () => {
    const service = createLanguageService();
    const cases = [
      {
        content: "I am interested in research papers about memory systems.",
        locale: "en-US",
        query: "Can you recommend research papers?",
      },
      {
        content: "我對記憶系統研究論文感興趣。",
        locale: "zh-TW",
        query: "請推薦記憶系統研究論文。",
      },
      {
        content: "メモリシステムの研究論文に興味があります。",
        locale: "ja-JP",
        query: "メモリシステムの研究論文をおすすめしてください。",
      },
    ];

    for (const value of cases) {
      expect(service.analyzeQuery(value.query, value.locale).recommendationStyle)
        .toBe(true);
      expect(service.analyzeContent(value.content, value.locale).preferenceEvidence)
        .toBe(true);
    }

    expect(
      service.analyzeContent(
        "現在以 docs/current.md 為準，不再以 docs/old.md 為準。",
        "zh-TW",
      ).sourceOfTruthDirective,
    ).toEqual({
      currentPointer: "docs/current.md",
      supersededPointer: "docs/old.md",
    });
    expect(
      service.analyzeContent("docs/current.mdを正とする。", "ja-JP")
        .sourceOfTruthDirective,
    ).toEqual({ currentPointer: "docs/current.md" });
  });

  it("keeps localized credential labels inside content analysis", () => {
    const service = createLanguageService();

    expect(service.analyzeContent("password: ordinary-value", "en-US").sensitiveCredential)
      .toBe(true);
    expect(service.analyzeContent("密碼：ordinary-value", "zh-TW").sensitiveCredential)
      .toBe(true);
    expect(service.analyzeContent("密码：ordinary-value", "zh-CN").sensitiveCredential)
      .toBe(true);
    expect(service.analyzeContent("パスワード: ordinary-value", "ja-JP").sensitiveCredential)
      .toBe(true);
    expect(service.analyzeContent("비밀번호: ordinary-value", "ko-KR").sensitiveCredential)
      .toBe(true);
    expect(service.analyzeContent("mot de passe : ordinary-value", "fr-FR").sensitiveCredential)
      .toBe(true);
    expect(service.analyzeContent("contraseña: ordinary-value", "es-ES").sensitiveCredential)
      .toBe(true);
    expect(service.analyzeContent("token budgeting is useful", "en-US").sensitiveCredential)
      .toBe(false);
  });

  it("keeps Chinese equality and search terms local to each script", () => {
    const service = createLanguageService();
    const simplified = "数据库迁移";
    const traditional = "資料庫遷移";

    expect(service.normalizeForEquality(simplified, "zh-CN")).not.toBe(
      service.normalizeForEquality(traditional, "zh-TW"),
    );
    expect(
      service.buildSearchTerms(simplified, "zh-CN").some((term) =>
        service.buildSearchTerms(traditional, "zh-TW").includes(term)
      ),
    ).toBe(false);
    expect(service.localesCompatible("zh-CN", "zh-TW")).toBe(false);
  });

  it("keeps short English content tokens such as acronyms and codes", () => {
    const service = createLanguageService();
    const resolved = service.resolveFromText({ text: "RL and AI work in SF." });

    const tokens = service.tokenize("RL and AI work in SF.", resolved, {
      excludeStopwords: true,
    });
    expect(tokens).toContain("rl");
    expect(tokens).toContain("ai");
    expect(tokens).toContain("sf");
    expect(tokens).not.toContain("and");
    expect(tokens).not.toContain("in");

    // Without stopword exclusion the function words stay available to callers
    // that want raw tokens.
    const rawTokens = service.tokenize("RL and AI work in SF.", resolved);
    expect(rawTokens).toContain("and");
    expect(rawTokens).toContain("in");
  });

  it("filters English contraction function words from content tokens", () => {
    const service = createLanguageService();
    const resolved = service.resolveFromText({
      locale: "en-US",
      text: "I'm writing about it.",
    });

    expect(
      service.tokenize("I'm writing about it.", resolved, {
        excludeStopwords: true,
      }),
    ).toEqual(["writing"]);
  });

  it("keeps the naive overlap signal on its calibrated length floor", () => {
    const service = createLanguageService();

    // Short tokens stay out of the Jaccard overlap on purpose: its max
    // denominator would let them dilute every calibrated score. Short-token
    // matching is the BM25/fusion channels' job.
    const shortOnly = service.tokenOverlap(
      "Marco is learning RL for robot control.",
      "What is RL used for?",
      "en-US",
      { excludeStopwords: true },
    );
    expect(shortOnly).toBe(0);

    // Anti-dilution guard: adding short content words to one side must not
    // change an established overlap score.
    const base = service.tokenOverlap(
      "avoid DeepAnalyzer first",
      "please avoid DeepAnalyzer",
      "en-US",
      { excludeStopwords: true },
    );
    const diluted = service.tokenOverlap(
      "avoid DeepAnalyzer first and use it",
      "please avoid DeepAnalyzer",
      "en-US",
      { excludeStopwords: true },
    );
    expect(base).toBeGreaterThan(0);
    expect(diluted).toBe(base);
  });

  it("keeps one-sided numeric metadata out of overlap without losing numeric matches", () => {
    const service = createLanguageService();
    const options = { excludeStopwords: true };
    const context = "en-US";
    const query = "Which Yosemite adventure was a camping trip?";
    const fact = "I took a solo camping trip to Yosemite National Park.";

    expect(
      service.tokenOverlap(
        "On 2023/05/15, I took a solo camping trip to Yosemite National Park.",
        query,
        context,
        options,
      ),
    ).toBe(service.tokenOverlap(fact, query, context, options));

    const matchingYear = service.tokenOverlap(
      "The Yosemite camping trip happened in 2023.",
      "Which Yosemite trip happened in 2023?",
      context,
      options,
    );
    const conflictingYear = service.tokenOverlap(
      "The Yosemite camping trip happened in 2024.",
      "Which Yosemite trip happened in 2023?",
      context,
      options,
    );
    expect(matchingYear).toBeGreaterThan(conflictingYear);
  });

  it("supports Chinese query intent and polarity detection", () => {
    const service = createLanguageService();

    expect(service.isAnswerCompositionQuery("我应该怎么回复这个用户？", "zh-CN")).toBe(true);
    expect(service.isAnswerCompositionQuery("请总结当前发布状态。", "zh-CN")).toBe(true);
    expect(service.isContinuationQuery("继续上次的工作流修复。", "zh-CN")).toBe(true);
    expect(service.isActionDrivingQuery("请使用这些记忆决定下一步。", "zh-CN")).toBe(true);
    expect(service.isActionDrivingQuery("我应该用哪个工作流文档？", "zh-CN")).toBe(false);
    expect(service.isRoleQuery("我当前的角色是什么？", "zh-CN")).toBe(true);
    expect(service.isBlockerQuery("当前阻塞是什么？", "zh-CN")).toBe(true);
    expect(service.isRoleFact("我当前角色是平台工程负责人。", "zh-CN")).toBe(true);
    expect(service.isBlockerFact("当前阻塞是供应商审批。", "zh-CN")).toBe(true);
    expect(service.detectFactPolarity("工作流仍然被阻塞。", "zh-CN")).toBe("negative");
    expect(service.detectFactPolarity("工作流已经稳定。", "zh-CN")).toBe("positive");
  });

  it("supports Chinese recall selection query families", () => {
    const service = createLanguageService();

    expect(service.isGuidanceSeekingQuery("以后回复有什么格式要求？", "zh-CN")).toBe(true);
    expect(service.isDirectFactualLookupQuery("我上次买了什么？", "zh-CN")).toBe(true);
    expect(service.isAggregateCountQuery("这些维修总共花了多少钱？", "zh-CN")).toBe(true);
    expect(service.isRecommendationStyleQuery("厨房又乱了，有什么建议？", "zh-CN")).toBe(true);
    expect(service.isAssistantEvidenceRecallQuery("你之前给我的清单里第七项是什么？", "zh-CN")).toBe(true);
    expect(service.isPersonalEvidenceSignal("我家的水龙头有点漏水。", "zh-CN")).toBe(true);
    expect(service.isPreferenceEvidenceSignal("我想要更安静的晚上活动。", "zh-CN")).toBe(true);
  });

  it("supports English slot-scoped query and fact intents", () => {
    const service = createLanguageService();

    expect(service.isRoleQuery("What is my current role?", "en-US")).toBe(true);
    expect(
      service.isRoleQuery(
        "When is the deadline for submitting my application for the senior producer role at Montserrat Media Corp?",
        "en-US",
      ),
    ).toBe(false);
    expect(
      service.isRoleQuery(
        "What was the age and role of the mentor who suggested I attend the workshop?",
        "en-US",
      ),
    ).toBe(false);
    expect(service.isFocusQuery("What is my current focus?", "en-US")).toBe(true);
    expect(service.isOpenLoopQuery("What is the open loop right now?", "en-US")).toBe(
      true,
    );
    expect(
      service.isOpenLoopQuery(
        "How many items do I need to pick up or return from a store?",
        "en-US",
      ),
    ).toBe(true);
    expect(
      service.isOpenLoopQuery(
        "I got a message that I need to verify my identity; what do I do?",
        "en-US",
      ),
    ).toBe(false);
    expect(
      service.isContinuationQuery(
        "How many items do I need to pick up or return from a store?",
        "en-US",
      ),
    ).toBe(false);
    expect(
      service.isContinuationQuery("Let's pick up where we left off.", "en-US"),
    ).toBe(true);
    expect(service.isBlockerQuery("What is the current blocker?", "en-US")).toBe(
      true,
    );
    expect(service.isActionDrivingQuery("Use this memory to decide the next step.", "en-US")).toBe(
      true,
    );
    expect(service.isAnswerCompositionQuery("Please summarize the current rollout status.", "en-US")).toBe(
      true,
    );
    expect(
      service.isAggregateCountQuery(
        "How much total money have I spent on repairs?",
        "en-US",
      ),
    ).toBe(true);
    expect(
      service.isAggregateCountQuery(
        "How did Rowan describe the time spent restoring telescopes with volunteers?",
        "en-US",
      ),
    ).toBe(false);
    expect(
      service.isAggregateCountQuery(
        "What did I spend in total on the workshop?",
        "en-US",
      ),
    ).toBe(true);
    expect(
      service.isAggregateCountQuery(
        "Add up what I spent on the two prototypes.",
        "en-US",
      ),
    ).toBe(true);
    expect(service.isActionDrivingQuery("Which workflow doc should I use?", "en-US")).toBe(
      false,
    );
    expect(
      service.isRoleFact(
        "my current role is staff platform engineer leading runtime reliability.",
        "en-US",
      ),
    ).toBe(true);
    expect(
      service.isRoleFact(
        "I am a robotics engineer in Shanghai leading the migration rollout.",
        "en-US",
      ),
    ).toBe(true);
    expect(
      service.isFocusFact("my current focus is stabilizing release workflows.", "en-US"),
    ).toBe(true);
    expect(
      service.isFocusFact("I am leading the migration rollout.", "en-US"),
    ).toBe(true);
    expect(service.isOpenLoopFact("The open loop is pending signoff.", "en-US")).toBe(
      true,
    );
    expect(service.isOpenLoopFact("I need to return some boots to Zara.", "en-US")).toBe(
      true,
    );
    expect(
      service.isBlockerFact("The current blocker is vendor approval.", "en-US"),
    ).toBe(true);
  });

  it("classifies Chinese feedback signals", () => {
    const service = createLanguageService();

    expect(service.deriveFeedbackKind("请以后优先用要点回答。", "zh-CN")).toBe("prefer");
    expect(service.deriveFeedbackKind("不要展开太多背景。", "zh-CN")).toBe("dont");
    expect(service.deriveFeedbackKind("这个格式对我很有用，继续这样做。", "zh-CN")).toBe(
      "validated_pattern",
    );
  });

  it("recognizes Chinese assistant acknowledgements and unresolved signals", () => {
    const service = createLanguageService();

    expect(service.isAssistantAcknowledgement("好的。", "zh-CN")).toBe(true);
    expect(service.isAssistantContinuitySignal("我会继续跟进这个阻塞。", "zh-CN")).toBe(true);
    expect(service.isUnresolvedSignal("这个问题后续还要继续跟进。", "zh-CN")).toBe(true);
  });
});
