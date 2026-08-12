import { describe, expect, it } from "bun:test";

import { extractReferencePointers } from "../../src/domain/referencePointer";
import { createLanguageService } from "../../src/language";
import { normalizeMemoryCandidate } from "../../src/remember/normalization";

describe("profile candidate normalization", () => {
  it("does not turn a contextual topic into a profile name", () => {
    const normalized = normalizeMemoryCandidate(
      {
        id: "topic-profile",
        kindHint: "profile",
        explicitness: "explicit",
        content:
          "Career and well-being discussion: The user wants a role that supports personal well-being.",
        sourceMessageIndex: 0,
        sourceRole: "user",
      },
      "I've been reflecting on my career and need to make a change.",
    );

    expect(normalized.content).toStartWith("Career and well-being discussion");
    expect(normalized.metadata?.profileField).toBeUndefined();
  });

  it("still salvages a missing name field from an explicit name statement", () => {
    const language = createLanguageService();
    const normalized = normalizeMemoryCandidate(
      {
        id: "explicit-name",
        kindHint: "profile",
        explicitness: "explicit",
        content: "User's name is Nadia and she works in Toronto.",
        sourceMessageIndex: 0,
        sourceRole: "user",
      },
      "My name is Nadia and I work in Toronto.",
      {
        language,
        resolved: language.resolveFromText({
          locale: "en-US",
          text: "My name is Nadia and I work in Toronto.",
        }),
      },
    );

    expect(normalized.content).toBe("Nadia");
    expect(normalized.metadata?.profileField).toBe("name");
  });

  it("uses the bounded source name when assisted extraction includes a trailing clause", () => {
    const language = createLanguageService();
    const cases = [
      {
        expected: "Nadia",
        source: "My name is Nadia and my role is designer.",
      },
      {
        expected: "Mary Jane",
        source: "My name is Mary Jane and she works in Toronto.",
      },
      {
        expected: "John Q. Public",
        source: "My name is John Q. Public.",
      },
    ];

    for (const [index, { expected, source }] of cases.entries()) {
      const normalized = normalizeMemoryCandidate(
        {
          id: `assisted-name-${index}`,
          kindHint: "profile",
          explicitness: "explicit",
          content: `User profile name: ${source}`,
          sourceMessageIndex: 0,
          sourceRole: "user",
          metadata: { profileField: "name" },
        },
        source,
        {
          language,
          resolved: language.resolveFromText({ locale: "en-US", text: source }),
        },
      );

      expect(normalized.content).toBe(expected);
    }
  });

  it("extracts the canonical name from a Chinese assisted sentence", () => {
    const language = createLanguageService({ defaultLocale: "zh-CN" });
    const source = "我的名字是张伟";
    const resolved = language.resolveFromText({ locale: "zh-CN", text: source });

    const normalized = normalizeMemoryCandidate(
      {
        id: "assisted-chinese-name",
        kindHint: "profile",
        explicitness: "explicit",
        content: source,
        sourceMessageIndex: 0,
        sourceRole: "user",
        metadata: { profileField: "name" },
      },
      source,
      { language, resolved },
    );

    expect(normalized.content).toBe("张伟");
  });
});

describe("reference candidate normalization", () => {
  it("does not accept source-of-truth authority without a source directive", () => {
    const language = createLanguageService();
    const source = "Hello";
    const resolved = language.resolveFromText({ locale: "en-US", text: source });
    const normalized = normalizeMemoryCandidate(
      {
        id: "unproven-source-of-truth",
        kindHint: "reference",
        explicitness: "explicit",
        content: "docs/secret.md",
        sourceMessageIndex: 0,
        sourceRole: "user",
        metadata: {
          referenceKind: "source_of_truth",
          referencePointer: "docs/secret.md",
        },
      },
      source,
      { language, resolved },
    );

    expect(normalized.kindHint).toBe("noise");
  });

  it("does not infer supersession from an unrelated second pointer", () => {
    const language = createLanguageService();
    const source =
      "Use docs/current.md as the source of truth and compare notes/status.md for context.";
    const resolved = language.resolveFromText({ locale: "en-US", text: source });
    const normalized = normalizeMemoryCandidate(
      {
        id: "reference-with-context",
        kindHint: "reference",
        explicitness: "explicit",
        content: "Use docs/current.md and compare notes/status.md for context.",
        sourceMessageIndex: 0,
        sourceRole: "user",
        metadata: {
          referenceKind: "source_of_truth",
          referencePointer: "docs/current.md",
        },
      },
      source,
      { language, resolved },
    );

    expect(normalized.metadata?.referencePointer).toBe("docs/current.md");
    expect(normalized.metadata?.supersedesPointer).toBeUndefined();
  });

  it("extracts Unicode paths without consuming adjacent language syntax", () => {
    expect(extractReferencePointers("请查看 文档/当前运行手册.md。"))
      .toEqual(["文档/当前运行手册.md"]);
    expect(extractReferencePointers("参照先は 資料/現在の手順書.md。"))
      .toEqual(["資料/現在の手順書.md"]);
    expect(
      extractReferencePointers("以https://example.com/docs/runbook.md为准。"),
    ).toEqual(["https://example.com/docs/runbook.md"]);
  });

  it("rejects metadata-only supersession without source-language proof", () => {
    const language = createLanguageService();
    const source = "Use docs/current.md as the source of truth.";
    const resolved = language.resolveFromText({ locale: "en-US", text: source });
    const analysis = language.analyzeContent(source, resolved);

    for (const supersedesPointer of [
      "docs/fabricated.md",
      "docs/current.md",
      "release v0.7.0",
      "not a pointer",
      "",
    ]) {
      const normalized = normalizeMemoryCandidate(
        {
          id: `metadata-${supersedesPointer}`,
          kindHint: "reference",
          explicitness: "explicit",
          content: "docs/current.md",
          sourceMessageIndex: 0,
          sourceRole: "user",
          metadata: {
            referenceKind: "source_of_truth",
            referencePointer: "docs/current.md",
            supersedesPointer,
          },
        },
        source,
        { analysis, language, resolved },
      );

      expect(normalized.metadata?.supersedesPointer).toBeUndefined();
      expect(
        Object.hasOwn(normalized.metadata ?? {}, "supersedesPointer"),
      ).toBe(false);
    }
  });

  it("removes unproven supersession even when normalization cannot produce a reference", () => {
    const language = createLanguageService();
    const source = "I prefer concise answers.";
    const resolved = language.resolveFromText({ locale: "en-US", text: source });
    const analysis = language.analyzeContent(source, resolved);

    for (const candidate of [
      {
        id: "invalid-reference",
        kindHint: "reference" as const,
        explicitness: "explicit" as const,
        content: "not a pointer",
        sourceMessageIndex: 0,
        sourceRole: "user" as const,
        metadata: { supersedesPointer: "docs/fabricated.md" },
      },
      {
        id: "unrelated-preference",
        kindHint: "preference" as const,
        explicitness: "explicit" as const,
        content: "concise answers",
        sourceMessageIndex: 0,
        sourceRole: "user" as const,
        metadata: {
          preferenceCategory: "response_style",
          supersedesPointer: "docs/fabricated.md",
        },
      },
    ]) {
      const normalized = normalizeMemoryCandidate(candidate, source, {
        analysis,
        language,
        resolved,
      });

      expect(
        Object.hasOwn(normalized.metadata ?? {}, "supersedesPointer"),
      ).toBe(false);
    }
  });

  it("uses the source directive instead of a conflicting metadata hint", () => {
    const language = createLanguageService();
    const source =
      "docs/current.md is now the source of truth, not docs/old.md.";
    const resolved = language.resolveFromText({ locale: "en-US", text: source });
    const analysis = language.analyzeContent(source, resolved);
    const normalized = normalizeMemoryCandidate(
      {
        id: "source-proven-supersession",
        kindHint: "reference",
        explicitness: "explicit",
        content: "docs/current.md",
        sourceMessageIndex: 0,
        sourceRole: "user",
        metadata: {
          referenceKind: "source_of_truth",
          referencePointer: "docs/current.md",
          supersedesPointer: "docs/fabricated.md",
        },
      },
      source,
      { analysis, language, resolved },
    );

    expect(analysis.sourceOfTruthDirective).toEqual({
      currentPointer: "docs/current.md",
      supersededPointer: "docs/old.md",
    });
    expect(normalized.metadata?.supersedesPointer).toBe("docs/old.md");
  });

  it("rejects self-supersession even when supplied by typed analysis", () => {
    const language = createLanguageService();
    const source = "Use docs/current.md as the source of truth.";
    const resolved = language.resolveFromText({ locale: "en-US", text: source });
    const analysis = {
      ...language.analyzeContent(source, resolved),
      sourceOfTruthDirective: {
        currentPointer: "docs/current.md",
        supersededPointer: "docs/current.md",
      },
    };
    const normalized = normalizeMemoryCandidate(
      {
        id: "self-supersession",
        kindHint: "reference",
        explicitness: "explicit",
        content: "docs/current.md",
        sourceMessageIndex: 0,
        sourceRole: "user",
        metadata: {
          referenceKind: "source_of_truth",
          referencePointer: "docs/current.md",
        },
      },
      source,
      { analysis, language, resolved },
    );

    expect(normalized.metadata?.supersedesPointer).toBeUndefined();
  });
});
