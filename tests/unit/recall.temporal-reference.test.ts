import { describe, expect, it } from "bun:test";
import { createLanguageService } from "../../src/language";
import { resolveTemporalReference } from "../../src/recall/temporalReference";

describe("recall temporal reference resolution", () => {
  const language = createLanguageService();
  const referenceTime = "2026-07-16T15:30:00.000Z";

  const resolve = (text: string, locale: string) => {
    const context = language.resolveFromText({ locale, text });
    return resolveTemporalReference(
      language.parseTemporalExpressions(text, context),
      referenceTime,
    );
  };

  it("performs UTC calendar arithmetic outside the language pack", () => {
    const cases = [
      ["today", "en-US", "2026-07-16T00:00:00.000Z"],
      ["yesterday", "en-US", "2026-07-15T00:00:00.000Z"],
      ["tomorrow", "en-US", "2026-07-17T00:00:00.000Z"],
      ["3 days ago", "en-US", "2026-07-13T00:00:00.000Z"],
      ["next week", "en-US", "2026-07-23T00:00:00.000Z"],
      ["this quarter", "en-US", "2026-07-01T00:00:00.000Z"],
      ["前天", "zh-CN", "2026-07-14T00:00:00.000Z"],
      ["后天", "zh-CN", "2026-07-18T00:00:00.000Z"],
      ["下季度", "zh-CN", "2026-10-01T00:00:00.000Z"],
      ["一昨日", "ja-JP", "2026-07-14T00:00:00.000Z"],
      ["明後日", "ja-JP", "2026-07-18T00:00:00.000Z"],
      ["来月", "ja-JP", "2026-08-01T00:00:00.000Z"],
      ["来年", "ja-JP", "2027-01-01T00:00:00.000Z"],
    ] as const;
    for (const [text, locale, expected] of cases) {
      expect(resolve(text, locale)).toBe(expected);
    }
  });

  it("resolves language-parsed absolute dates without pack-side Date math", () => {
    expect(resolve("March 5, 2026", "en-US")).toBe(
      "2026-03-05T00:00:00.000Z",
    );
    expect(resolve("2026年5月", "zh-TW")).toBe(
      "2026-05-01T00:00:00.000Z",
    );
  });
});
