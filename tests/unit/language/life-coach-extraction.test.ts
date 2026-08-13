import { describe, expect, it } from "bun:test";
import { createLanguageService } from "../../../src/language";

describe("LanguagePack life-coach candidate extraction", () => {
  it("keeps the English HTTP product phrases on the default pack path", () => {
    const language = createLanguageService();
    const durableFacts = [
      "My top priority this quarter is rebuilding my sleep routine.",
      "My current goal is shipping Atlas.",
      "My habit is journaling before bed.",
    ];

    for (const [index, text] of durableFacts.entries()) {
      const context = language.resolveFromText({ locale: "en-US", text });
      const candidates = language.extractCandidates({
        locale: context.locale,
        messages: [{ content: text, role: "user" }],
        nextId: () => `candidate-${index}`,
      }, context);

      expect(candidates.length, text).toBeGreaterThan(0);
    }

    for (const [index, text] of [
      "Please coach me with short prompts.",
      "Keep doing weekly reviews.",
    ].entries()) {
      const context = language.resolveFromText({ locale: "en-US", text });
      expect(language.extractCandidates({
        locale: context.locale,
        messages: [{ content: text, role: "user" }],
        nextId: () => `one-off-${index}`,
      }, context)).toEqual([]);
    }

    for (const [index, text] of [
      "Always coach me with short prompts.",
      "Always keep doing weekly reviews.",
    ].entries()) {
      const context = language.resolveFromText({ locale: "en-US", text });
      expect(language.extractCandidates({
        locale: context.locale,
        messages: [{ content: text, role: "user" }],
        nextId: () => `durable-guidance-${index}`,
      }, context)).toEqual([
        expect.objectContaining({ kindHint: "feedback" }),
      ]);
    }
  });

  it("extracts localized goals without changing HTTP business code", () => {
    const language = createLanguageService();
    for (const { locale, text } of [
      { locale: "zh-TW", text: "我目前的目標是改善睡眠。" },
      { locale: "ja-JP", text: "私の現在の目標は睡眠を改善することです。" },
      { locale: "ko-KR", text: "제 현재 목표는 수면을 개선하는 것입니다." },
      { locale: "fr-FR", text: "Mon objectif actuel est d’améliorer mon sommeil." },
      { locale: "es-ES", text: "Mi objetivo actual es mejorar mi sueño." },
    ] as const) {
      const context = language.resolveFromText({ locale, text });
      const candidates = language.extractCandidates({
        locale: context.locale,
        messages: [{ content: text, role: "user" }],
        nextId: () => `candidate-${locale}`,
      }, context);

      expect(candidates.some(({ kindHint }) => kindHint === "fact"), locale)
        .toBe(true);
    }
  });
});
