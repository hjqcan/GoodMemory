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
});
